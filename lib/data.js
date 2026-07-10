import { getSupabase } from "@/lib/supabase";
import { computeNba } from "@/lib/nba";
import { getCompanySignalsByAccount, mergeSignals } from "@/lib/signals";

// Couche de données partagée entre les pages serveur (rendu SSR : données dans
// le HTML) et les routes API (rafraîchissement client après mutation). Une seule
// source de vérité pour les requêtes → pas de divergence de colonnes/logique.

// Colonnes affichées par le tableau de bord (funnel, table, puces). On évite
// `select *` (notes ~10 Ko + colonnes inutiles).
const LIST_COLUMNS =
  "id, first_name, last_name, role, company, status, fit_score, email, phone, email_confidence, do_not_contact, follow_up_at, next_action, tags";

export async function listProspects(supabase = getSupabase()) {
  const { data } = await supabase
    .from("prospects")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false });
  return data || [];
}

// Top 10 prospects actifs triés par priorité NBA (déterministe, sans LLM).
export async function computePriorities(supabase = getSupabase()) {
  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, role, company, status, fit_score, email, phone, account_id, researched_at, do_not_contact, follow_up_at, next_action")
    .not("status", "in", '("refuse","client")')
    .eq("do_not_contact", false)
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(80);

  if (!prospects?.length) return [];
  const ids = prospects.map((p) => p.id);
  const accountIds = [...new Set(prospects.map((p) => p.account_id).filter(Boolean))];

  const [{ data: researchRows }, { data: draftRows }, companySignalsByAccount] = await Promise.all([
    supabase.from("research").select("prospect_id, id, signals, created_at").in("prospect_id", ids).order("created_at", { ascending: false }),
    supabase.from("drafts").select("prospect_id, id, created_at").in("prospect_id", ids).order("created_at", { ascending: false }),
    getCompanySignalsByAccount(supabase, accountIds),
  ]);

  const researchMap = {};
  for (const r of researchRows || []) if (!researchMap[r.prospect_id]) researchMap[r.prospect_id] = r;
  const draftsMap = {};
  for (const d of draftRows || []) if (!draftsMap[d.prospect_id]) draftsMap[d.prospect_id] = d;

  // Les signaux collectés (BOAMP, France Travail…) enrichissent la NBA : un
  // RFP frais sur le compte doit faire monter la priorité même si la dernière
  // qualification LLM ne l'a pas vu.
  const scored = prospects.map((p) => {
    const research = researchMap[p.id] || null;
    const accountSignals = p.account_id ? companySignalsByAccount.get(p.account_id) || [] : [];
    const enriched = research
      ? { ...research, signals: mergeSignals(accountSignals, research.signals || []) }
      : null;
    return {
      ...p,
      top_signal: accountSignals[0] || research?.signals?.[0] || null,
      nba: computeNba({ prospect: p, research: enriched, drafts: draftsMap[p.id] || null }),
    };
  });
  scored.sort((a, b) => b.nba.priority - a.nba.priority);
  return scored.slice(0, 10);
}

// Détail complet d'une fiche prospect (prospect + dernière recherche/brouillon +
// timeline + dernier brief). Renvoie { error } si introuvable.
export async function getProspectDetail(supabase, id) {
  const [{ data: prospect, error }, { data: research }, { data: drafts }, { data: events }, { data: briefs }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", id).single(),
    supabase.from("research").select("*").eq("prospect_id", id).order("created_at", { ascending: false }).limit(1),
    supabase.from("drafts").select("*").eq("prospect_id", id).order("created_at", { ascending: false }).limit(1),
    supabase.from("events").select("*").eq("prospect_id", id).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("prospect_briefs").select("*").eq("prospect_id", id).order("created_at", { ascending: false }).limit(1),
  ]);

  if (error) return { error: error.message };
  return {
    prospect,
    research: research?.[0] || null,
    drafts: drafts?.[0] || null,
    events: events || [],
    brief: briefs?.[0] || null,
  };
}
