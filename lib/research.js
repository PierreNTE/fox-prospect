import { callClaudeJson } from "@/lib/anthropic";
import {
  researchSystemPrompt, researchUserPrompt,
  extractionSystemPrompt, extractionUserPrompt,
  companyExtractionSystemPrompt, companyExtractionUserPrompt,
  contactExtractionSystemPrompt, contactExtractionUserPrompt,
  judgmentSystemPrompt, judgmentUserPrompt,
} from "@/lib/prompts";
import { validateResearch, EXTRACTION_SCHEMA, JUDGMENT_SCHEMA } from "@/lib/schemas";
import { computeScores } from "@/lib/scoring";
import { logAiRun } from "@/lib/ai-runs";
import { logEvent } from "@/lib/events";
import { recomputeProspectScores } from "@/lib/scores";
import { getEnvConfig, MODEL_HAIKU, MODEL_SONNET } from "@/lib/constants";

// Cœur de la qualification — réutilisé par /api/research (au clic) et par le
// worker de jobs (qualification autonome). Ne porte PAS les garde-fous HTTP
// (plafond quotidien, kill-switch budget) : l'appelant les pose.
//
// Économie de la chaîne (S2) :
//   1a. Extraction ENTREPRISE (Haiku + web_search) — MUTUALISÉE par compte via
//       le cache company_research (TTL FRESHNESS_TTL_DAYS). 5 prospects du même
//       compte = 1 seule extraction entreprise.
//   1b. Extraction CONTACT (Haiku + 1 web_search) — légère, par prospect.
//   2.  Jugement (Sonnet, sans web_search, sans hooks) — SEULEMENT s'il y a des
//       faits. 0 fait → résultat déterministe, zéro token Sonnet.
//   Les hooks/accroches sont générés à la demande dans /api/generate.
//
// Renvoie { research, cached } ; lève en cas d'erreur (l'appelant décide).

// Extraction entreprise avec cache par compte. Silencieux si la table
// company_research n'existe pas encore (migration-v7 non appliquée) : on
// retombe alors sur une extraction non cachée.
async function getCompanyExtraction(supabase, prospect, { extractModel, maxSearches, freshnessTtlDays, force }) {
  if (!force && prospect.account_id) {
    const since = new Date(Date.now() - freshnessTtlDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from("company_research")
      .select("facts, company_context")
      .eq("account_id", prospect.account_id)
      .gte("updated_at", since)
      .maybeSingle();
    if (cached) {
      return { facts: cached.facts || [], company_context: cached.company_context || "", cached: true };
    }
  }

  const { json, usage, webSearchCount } = await callClaudeJson({
    system: companyExtractionSystemPrompt(),
    user: companyExtractionUserPrompt({ company: prospect.company, website: prospect.company_website }),
    // 4000 et non 2000. Un grand compte produit facilement une quinzaine de
    // faits sourcés : la sortie dépassait le plafond, était coupée en plein
    // tableau, et le JSON tronqué faisait échouer le job — 85 jobs en attente
    // portaient cette erreur au 2026-07-27. Relever un plafond de sortie ne
    // coûte rien tant qu'il n'est pas atteint : on ne paie que les jetons
    // réellement produits.
    maxTokens: 4000,
    webSearch: true,
    maxSearches,
    model: extractModel,
    schema: EXTRACTION_SCHEMA,
  });
  await logAiRun({ route: "research", prospectId: prospect.id, accountId: prospect.account_id, usage, webSearchCount, model: extractModel });

  const facts = Array.isArray(json?.facts) ? json.facts : [];
  const companyContext = json?.company_context || "";

  if (prospect.account_id) {
    await supabase.from("company_research").upsert(
      {
        account_id: prospect.account_id,
        facts,
        company_context: companyContext,
        model: extractModel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" }
    ).then(() => {}, () => {}); // cache best-effort, jamais bloquant
  }

  return { facts, company_context: companyContext, cached: false };
}

export async function runResearch(supabase, prospect, { force = false } = {}) {
  const { freshnessTtlDays, maxSearches } = getEnvConfig();

  // Cache de fraîcheur : évite une dépense en double si une recherche récente existe.
  if (!force) {
    const since = new Date(Date.now() - freshnessTtlDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("research")
      .select("*")
      .eq("prospect_id", prospect.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (recent) return { research: recent, cached: true };
  }

  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();

  const extractModel = process.env.RESEARCH_EXTRACT_MODEL === "sonnet" ? MODEL_SONNET : MODEL_HAIKU;

  // ── Passe 1 : extraction de faits (Haiku) ───────────────────────────────────
  let extraction = null;
  try {
    if (prospect.account_id) {
      // Extraction scindée : entreprise (mutualisée) + contact (1 search).
      const company = await getCompanyExtraction(supabase, prospect, {
        extractModel, maxSearches, freshnessTtlDays, force,
      });
      const { json: contactRaw, usage: uc, webSearchCount: wc } = await callClaudeJson({
        system: contactExtractionSystemPrompt(),
        user: contactExtractionUserPrompt({ prospect }),
        maxTokens: 2400,   // idem : marge de troncature, payée seulement si utilisée
        webSearch: true,
        maxSearches: 1,
        model: extractModel,
        schema: EXTRACTION_SCHEMA,
      });
      await logAiRun({ route: "research", prospectId: prospect.id, usage: uc, webSearchCount: wc, model: extractModel });

      extraction = {
        facts: [...company.facts, ...(Array.isArray(contactRaw?.facts) ? contactRaw.facts : [])],
        company_context: company.company_context,
        contact_context: contactRaw?.contact_context || "",
      };
    } else {
      // Sans compte rattaché : extraction combinée historique (une passe).
      const { json: extractionRaw, usage: u1, webSearchCount: w1 } = await callClaudeJson({
        system: extractionSystemPrompt(),
        user: extractionUserPrompt({ prospect, offer: settings?.offer }),
        maxTokens: 5000,   // extraction combinée : entreprise + contact dans une seule sortie
        webSearch: true,
        maxSearches,
        model: extractModel,
        schema: EXTRACTION_SCHEMA,
      });
      if (extractionRaw && Array.isArray(extractionRaw.facts)) {
        extraction = extractionRaw;
        await logAiRun({ route: "research", prospectId: prospect.id, usage: u1, webSearchCount: w1, model: extractModel });
      }
    }
  } catch {
    extraction = null; // repli mono-passe ci-dessous
  }

  // ── Passe 2 : jugement — conditionnel ───────────────────────────────────────
  let raw;
  if (extraction && extraction.facts.length === 0) {
    // Jugement conditionnel (S2) : aucun fait → résultat déterministe, zéro
    // token Sonnet. ~30 % des prospects n'ont aucune actu publique récente.
    raw = {
      summary: `Aucun fait public récent (9 mois) trouvé sur ${prospect.company}${extraction.company_context ? `. ${extraction.company_context}` : "."} La veille automatique réévaluera ce compte.`,
      signals: [],
      fit_score: 10,
      fit_reason: "Aucun signal d'achat détecté dans l'actualité publique récente — priorité basse en l'état, à réévaluer si un signal apparaît.",
      sources: [],
    };
  } else if (extraction) {
    // 4000 et non 1500. C'est CE plafond, et non ceux de l'extraction, qui
    // tronquait : mesuré sur août 2026, le jugement sort 1 275 jetons en
    // moyenne pour un maximum observé de 1 499 — il collait au plafond, et
    // 74 jobs s'y sont cassés. Le jugement produit un objet bien plus lourd
    // qu'une extraction (résumé + tableau de signaux typés et sourcés +
    // justification + sources) : lui donner l'enveloppe la plus étroite de la
    // chaîne était le mauvais arbitrage.
    let judgmentRaw, u2, w2;
    try {
      ({ json: judgmentRaw, usage: u2, webSearchCount: w2 } = await callClaudeJson({
        system: judgmentSystemPrompt(),
        user: judgmentUserPrompt({ prospect, extraction, offer: settings?.offer }),
        maxTokens: 4000,
        webSearch: false,
        schema: JUDGMENT_SCHEMA,
      }));
    } catch (e) {
      // Un appel qui échoue a quand même été facturé. Sans ce filet, la dépense
      // d'une troncature n'atteint jamais ai_runs — le kill-switch ne voit que
      // ce qui aboutit, et rejoue le trou que le tarif Haiku avait déjà creusé.
      if (e.usage) {
        await logAiRun({
          route: "research", prospectId: prospect.id, usage: e.usage,
          webSearchCount: e.webSearchCount ?? 0, model: MODEL_SONNET,
        });
      }
      throw e;
    }
    raw = judgmentRaw;
    await logAiRun({ route: "research", prospectId: prospect.id, usage: u2, webSearchCount: w2, model: MODEL_SONNET });
  } else {
    // Repli mono-passe historique (extraction échouée).
    const { json: singleRaw, usage: u, webSearchCount: w } = await callClaudeJson({
      system: researchSystemPrompt(),
      user: researchUserPrompt({ prospect, offer: settings?.offer }),
      maxTokens: 3000,
      webSearch: true,
      maxSearches,
    });
    raw = singleRaw;
    await logAiRun({ route: "research", prospectId: prospect.id, usage: u, webSearchCount: w, model: MODEL_SONNET });
  }

  const result = validateResearch(raw);

  const { data: saved, error: insertError } = await supabase
    .from("research")
    .insert({
      prospect_id: prospect.id,
      summary: result.summary,
      signals: result.signals,
      hooks: result.hooks,
      fit_score: result.fit_score,
      fit_reason: result.fit_reason,
      sources: result.sources,
    })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);

  // Score unifié (QW5) : on affiche partout le score DÉTERMINISTE explicable
  // (urgence × potentiel × accessibilité, cf. computeScores) plutôt que l'entier
  // LLM opaque. Le score LLM reste consigné dans `research.fit_score` comme
  // contexte qualitatif, mais ce qui pilote la liste et le badge est ce nombre-ci,
  // celui-là même que la décomposition de la fiche explique.
  const unifiedScore = computeScores({
    prospect,
    signals: result.signals || [],
    firmographics: {},
  }).global_score;

  // L'état de recherche est découplé du statut commercial (P2) : on horodate
  // researched_at au lieu de pousser le statut. Le statut ne bouge que via les
  // actions commerciales de l'utilisateur.
  await supabase
    .from("prospects")
    .update({
      fit_score: unifiedScore,
      researched_at: new Date().toISOString(),
    })
    .eq("id", prospect.id);

  logEvent({ kind: "research_done", prospectId: prospect.id });

  // Scores déterministes (table scores) : signaux frais + firmographie SIRENE.
  // Non bloquant — le scoring ne doit jamais faire échouer la qualification.
  await recomputeProspectScores(supabase, prospect, { researchSignals: result.signals });

  return { research: saved, cached: false };
}
