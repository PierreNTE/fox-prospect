import { getSupabase } from "@/lib/supabase";
import { computeNba } from "@/lib/nba";

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

  const [{ data: researchRows }, { data: draftRows }] = await Promise.all([
    supabase.from("research").select("prospect_id, id, signals, created_at").in("prospect_id", ids).order("created_at", { ascending: false }),
    supabase.from("drafts").select("prospect_id, id, created_at").in("prospect_id", ids).order("created_at", { ascending: false }),
  ]);

  const researchMap = {};
  for (const r of researchRows || []) if (!researchMap[r.prospect_id]) researchMap[r.prospect_id] = r;
  const draftsMap = {};
  for (const d of draftRows || []) if (!draftsMap[d.prospect_id]) draftsMap[d.prospect_id] = d;

  const scored = prospects.map((p) => ({
    ...p,
    nba: computeNba({ prospect: p, research: researchMap[p.id] || null, drafts: draftsMap[p.id] || null }),
  }));
  scored.sort((a, b) => b.nba.priority - a.nba.priority);
  return scored.slice(0, 10);
}

// Liste des comptes — colonnes légères uniquement : la liste n'a pas besoin des
// jsonb lourds (news, signals, sources, summary).
export async function listAccounts(supabase = getSupabase()) {
  const { data } = await supabase
    .from("accounts")
    .select("id, name, domain, sector, hq, website, auto_watch, last_refreshed_at, created_at")
    .order("name", { ascending: true });
  return data || [];
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
  return { account, contacts: contacts || [], prospects: prospects || [] };
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
