// Cœur de la fiche d'approche (IA + recherche web), partagé entre le bouton
// « Préparer » (/api/call-prep), la préparation en lot et l'agent hebdomadaire
// (job `call_prep` drainé par lib/process-jobs.js).
import { callClaudeJson } from "@/lib/anthropic";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { logAiRun } from "@/lib/ai-runs";
import { getEnvConfig, MODEL_SONNET, aiEnabled } from "@/lib/constants";
import { buildFreeCallPrep } from "@/lib/call-prep-free";
import {
  callPrepSystemPrompt, callPrepUserPrompt, normalizeCallPrep, contactsToInsert,
} from "@/lib/prompts-call-prep";

export class BudgetError extends Error {}

/**
 * Prépare (ou relit en cache) la fiche d'approche d'un compte.
 * @returns {{ prep, cached, generated_at, contacts_added? }}
 * Lève BudgetError si le plafond mensuel est atteint, Error sinon.
 */
export async function runCallPrep(supabase, account, { force = false } = {}) {
  if (!force && account.call_prep) {
    return { prep: account.call_prep, cached: true, generated_at: account.call_prep_at };
  }

  // Mode gratuit (par défaut) : fiche construite par règles, sans IA, instantanée.
  if (!aiEnabled()) return saveFreeCallPrep(supabase, account);

  const budget = await checkMonthlyBudget(supabase);
  if (budget.exceeded) throw new BudgetError(budgetMessage(budget));

  // Trouver un interlocuteur ET des coordonnées demande plus de recherches
  // qu'une qualification : au moins 4 (davantage si la config le permet).
  const maxSearches = Math.max(4, getEnvConfig().maxSearches || 0);
  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();

  try {
    const { json, usage, webSearchCount } = await callClaudeJson({
      system: callPrepSystemPrompt(),
      user: callPrepUserPrompt({ account, health: account.health_detail, sender: settings }),
      maxTokens: 4000,
      webSearch: true,
      maxSearches,
      model: MODEL_SONNET,
    });
    const prep = normalizeCallPrep(json);
    const now = new Date().toISOString();
    const accountUpdate = { call_prep: prep, call_prep_at: now };
    if (!account.website && prep.coordonnees.site) accountUpdate.website = prep.coordonnees.site;
    await supabase.from("accounts").update(accountUpdate).eq("id", account.id);

    // Interlocuteurs trouvés → organigramme du compte (enrichissables ensuite).
    const { data: existing } = await supabase
      .from("account_contacts").select("first_name, last_name").eq("account_id", account.id);
    const rows = contactsToInsert(prep, existing || [], account.id);
    let added = 0;
    if (rows.length) {
      const { data: ins, error: insErr } = await supabase.from("account_contacts").insert(rows).select("id");
      if (insErr) console.error(`[call-prep] contacts non enregistrés : ${insErr.message}`);
      added = ins?.length || 0;
    }
    await logAiRun({ route: "call_prep", accountId: account.id, usage, webSearchCount, model: MODEL_SONNET });
    return { prep, cached: false, generated_at: now, contacts_added: added };
  } catch (e) {
    if (e.usage) {
      await logAiRun({ route: "call_prep", accountId: account.id, usage: e.usage, webSearchCount: e.webSearchCount || 0, model: MODEL_SONNET });
    }
    throw e;
  }
}

/** Fiche gratuite (sans IA) : construite, enregistrée, dirigeants ajoutés à l'organigramme. */
export async function saveFreeCallPrep(supabase, account) {
  const [{ data: contacts }, { data: settings }] = await Promise.all([
    supabase.from("account_contacts").select("first_name, last_name, role, linkedin_url, source").eq("account_id", account.id).limit(50),
    supabase.from("settings").select("sender_name, sender_role").eq("id", 1).maybeSingle(),
  ]);
  // Standard saisi ou trouvé par le worker (v29) : lu ici si l'appelant ne l'a pas chargé.
  if (account.standard_phone === undefined) {
    const { data: std } = await supabase.from("accounts").select("standard_phone, standard_source").eq("id", account.id).maybeSingle();
    if (std) account = { ...account, ...std };
  }
  const prep = buildFreeCallPrep({ account, contacts: contacts || [], sender: settings || {} });
  const now = new Date().toISOString();
  const update = { call_prep: prep, call_prep_at: now };
  if (!account.website && prep.coordonnees.site) update.website = prep.coordonnees.site;
  const { error } = await supabase.from("accounts").update(update).eq("id", account.id);
  if (error) throw new Error(error.message);
  // Dirigeants légaux → organigramme (une seule fois, dédoublonné).
  const rows = contactsToInsert({ contacts: prep.contacts.filter((c) => c.source === "Dirigeant légal (RNE)") }, contacts || [], account.id);
  let added = 0;
  if (rows.length) {
    const { data: ins } = await supabase.from("account_contacts").insert(rows).select("id");
    added = ins?.length || 0;
  }
  return { prep, cached: false, generated_at: now, contacts_added: added, mode: "gratuit" };
}
