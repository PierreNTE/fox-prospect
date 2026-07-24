import { getSupabase } from "@/lib/supabase";
import { computeAccountHeatFull, signalPriority } from "@/lib/scoring";
import { NEWS_IMPACT, NEWS_IMPACT_DEFAULT } from "@/lib/constants";
import { codePays } from "@/lib/veille";

// Couche de données partagée entre les pages serveur (rendu SSR : données dans
// le HTML) et les routes API (rafraîchissement client après mutation). Une seule
// source de vérité pour les requêtes → pas de divergence de colonnes/logique.

// Colonnes affichées par le tableau de bord (funnel, table, puces). On évite
// `select *` (notes ~10 Ko + colonnes inutiles).
const LIST_COLUMNS =
  "id, first_name, last_name, role, company, status, fit_score, email, phone, email_confidence, do_not_contact, follow_up_at, next_action";

// Borné à 500 par défaut : la liste croît (~330 qualifs/mois) et le payload
// SSR suivait. Le tri created_at desc garde les récents ; la suite se charge
// à la demande via offset (« Voir plus » du dashboard).
export async function listProspects(supabase = getSupabase(), { limit = 500, offset = 0 } = {}) {
  const { data } = await supabase
    .from("prospects")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  return data || [];
}

// Liste des comptes. Les jsonb lourds (news, signals) sont rapatriés côté
// SERVEUR uniquement pour dériver la chaleur (QW2) puis écartés : le client ne
// reçoit que des scalaires légers (heat, news_count, last_news_date).
export async function listAccounts(supabase = getSupabase()) {
  // On rapatrie aussi les coordonnées des contacts pour dériver la joignabilité
  // par compte (Next Best Account, IA5) — agrégée côté serveur, jamais renvoyée
  // en détail au client.
  const [{ data: accts }, { data: contacts }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, domain, sector, hq, website, auto_watch, last_refreshed_at, created_at, signals, news")
      .order("name", { ascending: true }),
    supabase.from("account_contacts").select("account_id, email, phone, linkedin_url"),
  ]);

  const reach = new Map();
  for (const c of contacts || []) {
    const cur = reach.get(c.account_id) || { total: 0, reachable: 0 };
    cur.total += 1;
    if ((c.email || "").trim() || (c.phone || "").trim() || (c.linkedin_url || "").trim()) cur.reachable += 1;
    reach.set(c.account_id, cur);
  }

  return (accts || []).map(({ signals, news, ...rest }) => {
    const h = computeAccountHeatFull({ signals, news });
    const r = reach.get(rest.id) || { total: 0, reachable: 0 };
    return {
      ...rest,
      heat: h.heat, news_count: h.news_count, last_news_date: h.last_news_date,
      reachable_contacts: r.reachable, total_contacts: r.total,
    };
  });
}

// Détail complet d'une fiche compte (compte + organigramme + prospects liés).
// Renvoie { error } si introuvable. Partagé entre la page serveur et l'API.
export async function getAccountDetail(supabase, id) {
  const [{ data: account, error }, { data: contacts }, { data: prospects }] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", id).single(),
    supabase
      .from("account_contacts")
      .select("*")
      .eq("account_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("prospects").select("id, first_name, last_name, role, fit_score, status").eq("account_id", id),
  ]);
  if (error) return { error: error.message };

  // Timeline au niveau compte (FV4) : agrège les events de TOUS les prospects
  // rattachés — échanges, changements de statut, actions auto — pour donner la
  // mémoire du compte sans avoir à ouvrir chaque fiche.
  let events = [];
  const pids = (prospects || []).map((p) => p.id);
  if (pids.length) {
    const { data: evs } = await supabase
      .from("events")
      .select("*")
      .in("prospect_id", pids)
      .order("occurred_at", { ascending: false })
      .limit(50);
    events = evs || [];
  }

  // Affaires du compte (FV2) — pour la carte Opportunités de la fiche.
  const { data: opportunities } = await supabase
    .from("opportunities")
    .select("*")
    .eq("account_id", id)
    .order("created_at", { ascending: false });

  return { account, contacts: contacts || [], prospects: prospects || [], events, opportunities: opportunities || [] };
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

// Agenda (FV3) : fusionne les tâches datées et les relances de prospects
// (prospects.follow_up_at) — toutes les échéances au même endroit.
export async function getAgenda(supabase = getSupabase()) {
  const [{ data: tasks }, { data: relances }] = await Promise.all([
    supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }).limit(300),
    supabase
      .from("prospects")
      .select("id, first_name, last_name, company, follow_up_at, next_action, status, do_not_contact")
      .not("follow_up_at", "is", null)
      .not("status", "in", "(client,refuse)")
      .order("follow_up_at", { ascending: true })
      .limit(300),
  ]);
  return {
    tasks: tasks || [],
    relances: (relances || []).filter((p) => !p.do_not_contact),
  };
}

// Veille (IA3) : actualités à fort impact des N derniers jours, tous comptes
// confondus. AUCUN coût IA — on exploite ce que l'analyse de compte a déjà
// collecté ; la valeur ajoutée est le tri, le filtre et la mise en évidence.
// On NE filtre PAS sur une liste blanche de catégories : mesuré en base, une
// large majorité des actus historiques n'a AUCUNE catégorie. Une liste blanche
// vidait donc la carte. On classe par impact × fraîcheur sur 12 mois et on garde
// le haut du panier : la carte reste utile quel que soit l'état des données.
// (Le référentiel a depuis été élargi et rendu obligatoire dans le prompt, mais
// les actus déjà en base ne sont pas rétro-classées.)
export async function getVeille(supabase = getSupabase(), { months = 12, limit = 12 } = {}) {
  const { data } = await supabase.from("accounts").select("id, name, news").not("news", "is", null);
  const now = Date.now();
  const monthMs = 30.44 * 86400000;
  const cutoff = now - months * monthMs;
  const items = [];
  for (const a of data || []) {
    for (const n of Array.isArray(a.news) ? a.news : []) {
      const t = n?.date ? new Date(n.date).getTime() : NaN;
      if (!Number.isFinite(t) || t < cutoff) continue;
      // Catégorie absente ou hors référentiel → impact plancher, jamais exclue.
      const impact = NEWS_IMPACT[n?.category] ?? NEWS_IMPACT_DEFAULT;
      const ageMois = Math.max(0, (now - t) / monthMs);
      items.push({
        account_id: a.id, account_name: a.name,
        title: n.title || n.detail || "", category: n.category || "",
        date: n.date, url: n.url || n.source || "",
        score: impact * Math.exp(-(Math.LN2 / 6) * ageMois),
      });
    }
  }
  items.sort((x, y) => y.score - x.score);
  return items.slice(0, limit).map(({ score, ...rest }) => rest);
}

// Pipeline (FV2) : toutes les affaires + le nom de leur compte (jointure FK),
// aplati en `account_name` pour l'affichage.
export async function getPipeline(supabase = getSupabase()) {
  const { data } = await supabase
    .from("opportunities")
    .select("*, accounts(name)")
    .order("expected_close_date", { ascending: true, nullsFirst: false })
    .limit(500);
  return (data || []).map(({ accounts, ...o }) => ({ ...o, account_name: accounts?.name || "" }));
}

// ── Veille ─────────────────────────────────────────────────────────────────
// Colonnes explicites : `detail` peut porter jusqu'à 1000 caractères et la
// table grossit d'un passage quotidien. On ne charge que ce qui s'affiche.
const SIGNAL_COLUMNS =
  "id, account_id, type, product_line, title, detail, summary, relevance, observed_at, source_url, " +
  "confidence, match_method, match_confidence, lang, country_code, status, person_name";

/** Décore et trie une liste de signaux par priorité décroissante.
 *
 * Le tri se fait en JS et non en SQL parce que la priorité combine la fraîcheur
 * (fonction du moment présent) et des demi-vies par type qui vivent dans
 * lib/scoring.js. La dupliquer en SQL créerait deux classements divergents pour
 * les mêmes signaux — le défaut exact que la source de vérité unique des poids
 * d'actualité avait déjà corrigé.
 */
function classerSignaux(signaux) {
  const now = Date.now();
  return (signaux || [])
    .map((s) => ({ ...s, priority: signalPriority(s, now) }))
    .sort((a, b) => b.priority - a.priority);
}

/** Signaux détectés pour un compte, les plus prioritaires d'abord. */
export async function getAccountSignals(supabase, accountId, { limit = 40 } = {}) {
  const { data } = await supabase
    .from("company_signals")
    .select(SIGNAL_COLUMNS)
    .eq("account_id", accountId)
    .order("observed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return classerSignaux(data);
}

/**
 * Vue globale de la veille : signaux récents, santé des sources, candidats.
 *
 * Les trois sont chargés ensemble parce qu'ils répondent à trois questions que
 * le commercial se pose dans le même mouvement : qu'est-ce qui est arrivé,
 * est-ce que la collecte tourne encore, et qui prospecter ensuite.
 *
 * La santé des sources n'est pas un ornement d'administrateur : une source qui
 * change de format et renvoie zéro résultat ne lève aucune erreur. Sans cet
 * affichage, la veille se tarit en silence et personne ne s'en aperçoit.
 */
export async function getVeilleOverview(supabase, { limit = 120 } = {}) {
  const [
    { data: signals, error: eSignals },
    { data: sources, error: eSources },
    { data: candidats, error: eCandidats },
    { data: themes },
  ] = await Promise.all([
    supabase
      .from("company_signals")
      .select(`${SIGNAL_COLUMNS}, accounts(name)`)
      .not("account_id", "is", null)
      .order("observed_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase
      .from("veille_sources")
      .select("id, kind, label, url, country_code, enabled, account_id, last_run_at, last_ok_at, last_error")
      .order("kind")
      .order("label"),
    // Acheteurs publics repérés par TED sans compte correspondant : le statut
    // « classe » les distingue des documents écartés, et `reject_reason` porte
    // le nom de l'acheteur (« candidat: … »).
    supabase
      .from("veille_documents")
      // `lieux` est extrait du jsonb par PostgREST plutôt que rapatrié entier :
      // c'est la seule information de `raw` dont la vue a besoin, et elle sert
      // à équilibrer les candidats entre pays.
      .select("id, title, url, published_at, reject_reason, source_id, lieux:raw->place_of_performance")
      .eq("status", "classe")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(60),
    // Thèmes DÉJÀ vectorisés uniquement : un thème dont le vecteur n'a pas
    // encore été calculé par le passage quotidien ne renverrait rien, et un
    // filtre qui ne renvoie jamais rien se lit comme une veille vide.
    // Il n'apparaît donc pas — la migration v16 n'est pas une régression
    // visible tant que les briques NLP ne tournent pas.
    supabase
      .from("veille_themes")
      .select("id, label")
      .eq("enabled", true)
      .not("embedding", "is", null)
      .order("id"),
  ]);

  // Les erreurs sont REMONTÉES, pas absorbées. Une requête en échec renvoie
  // `data: null` : sans ce report, une colonne manquante s'affichait comme
  // « 0 source active — toutes ont collecté », c'est-à-dire un message
  // rassurant sur un système cassé. Le module de veille existe justement pour
  // rendre visible ce qui se tarit en silence ; son propre écran ne peut pas
  // faire l'inverse.
  const erreurs = [
    eSignals && `signaux : ${eSignals.message}`,
    eSources && `sources : ${eSources.message}`,
    eCandidats && `candidats : ${eCandidats.message}`,
  ].filter(Boolean);

  return {
    signals: classerSignaux(
      (signals || []).map(({ accounts, ...s }) => ({ ...s, account_name: accounts?.name || "" }))
    ),
    themes: themes || [],
    sources: sources || [],
    candidats: (candidats || []).map(({ lieux, ...d }) => ({
      ...d,
      acheteur: String(d.reject_reason || "").replace(/^candidat:\s*/, ""),
      pays: codePays(lieux),
    })),
    erreurs,
  };
}
