import { getSupabase } from "@/lib/supabase";
import { computeAccountHeatFull } from "@/lib/scoring";

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
  const { data } = await supabase
    .from("accounts")
    .select("id, name, domain, sector, hq, website, auto_watch, last_refreshed_at, created_at, signals, news")
    .order("name", { ascending: true });
  return (data || []).map(({ signals, news, ...rest }) => {
    const h = computeAccountHeatFull({ signals, news });
    return { ...rest, heat: h.heat, news_count: h.news_count, last_news_date: h.last_news_date };
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
