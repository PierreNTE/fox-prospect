// Agent hebdomadaire des leads Salesforce.
//
// Après chaque import (ou sur demande), l'agent met en file `jobs` une fiche
// d'approche (IA + recherche web, ≈ 0,10 €) pour les meilleurs comptes à appeler
// qui n'en ont pas encore : priorité A puis B (lib/lead-priority.js), jamais les
// comptes fermés, en procédure ou clos dans Salesforce. Le worker GitHub Actions
// (toutes les 2 h) et le cron Vercel quotidien drainent la file : aucune page à
// garder ouverte. Plafond glissant sur 7 jours (AGENT_PREP_MAX, défaut 15 ≈ 1,50 €)
// en plus du kill-switch budget mensuel.
//
// ZoomInfo n'est volontairement pas interrogé : licence Dell nominative, accès
// automatisé interdit par ses conditions. La recherche y reste manuelle.
import { listSalesforceLeads } from "@/lib/leads-import";

export const AGENT_DEFAULT_MAX = 15;
export const agentWeeklyMax = () => {
  const n = Number(process.env.AGENT_PREP_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : AGENT_DEFAULT_MAX;
};

const WEEK_MS = 7 * 86400_000;

/** Comptes éligibles, dans l'ordre de priorité (la liste arrive déjà triée). */
export function selectAgentTargets(leads, { room, queued = new Set(), tiers = ["A", "B"] } = {}) {
  if (!room || room <= 0) return [];
  return leads
    .filter((l) => l.health_status === "active"
      && !/closed/i.test(l.sf_lead_status || "")
      && !l.call_prep_at
      && tiers.includes(l.priority?.tier)
      && !queued.has(l.id))
    .slice(0, room);
}

async function callPrepJobs(supabase, sinceIso) {
  const { data } = await supabase
    .from("jobs")
    .select("payload, status, created_at, done_at, last_error")
    .eq("kind", "call_prep")
    .gte("created_at", sinceIso)
    .limit(2000);
  return data || [];
}

/** Met en file les fiches de la semaine. Renvoie { queued, room, max, already }. */
export async function runLeadsAgent(supabase, now = Date.now()) {
  const max = agentWeeklyMax();
  const since = new Date(now - WEEK_MS).toISOString();
  const recent = await callPrepJobs(supabase, since);
  const { data: open } = await supabase
    .from("jobs").select("payload").eq("kind", "call_prep").in("status", ["pending", "running"]);
  const queued = new Set([...(open || []), ...recent].map((j) => j.payload?.account_id).filter(Boolean));

  const room = Math.max(0, max - recent.length);
  const leads = await listSalesforceLeads(supabase, now);
  const targets = selectAgentTargets(leads, { room, queued });
  if (targets.length) {
    const { error } = await supabase.from("jobs").insert(
      // scheduled_at décalé d'une seconde par compte : la file respecte l'ordre de priorité.
      targets.map((l, i) => ({
        kind: "call_prep", payload: { account_id: l.id }, status: "pending",
        scheduled_at: new Date(now + i * 1000).toISOString(),
      })),
    );
    if (error) throw new Error(error.message);
  }
  return { queued: targets.length, room, max, already: recent.length, names: targets.map((l) => l.name) };
}

/** État de l'agent sur 7 jours, pour la page Leads. */
export async function leadsAgentStatus(supabase, now = Date.now()) {
  const jobs = await callPrepJobs(supabase, new Date(now - WEEK_MS).toISOString());
  const count = (s) => jobs.filter((j) => j.status === s).length;
  const lastError = jobs.filter((j) => j.last_error).map((j) => j.last_error).pop() || null;
  return {
    max: agentWeeklyMax(),
    week: jobs.length,
    pending: count("pending") + count("running"),
    done: count("done"),
    error: count("error"),
    last_error: lastError,
  };
}
