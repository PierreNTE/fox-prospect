import { callClaudeJson } from "@/lib/anthropic";
import { enrichSystemPrompt, enrichUserPrompt } from "@/lib/prompts-enrich";
import { validateEnrich } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { getEnvConfig, MODEL_HAIKU } from "@/lib/constants";

// Enrichissement des coordonnées d'un contact d'organigramme (account_contacts).
// Logique PARTAGÉE entre l'endpoint manuel (/api/account-contacts/[id]/enrich)
// et le worker de file (process-jobs, kind=enrich_contact) déclenché en veille.
//
// Principe : une fiche compte doit toujours offrir au moins une coordonnée
// exploitable. On ne comble QUE les trous (jamais d'écrasement d'une donnée
// existante), et on marque toujours email_confidence (défaut "basse" côté
// validateEnrich) → un contact déjà tenté ne sera pas ré-enfilé indéfiniment.
export async function enrichAccountContact(supabase, contactId) {
  const { data: contact, error } = await supabase
    .from("account_contacts")
    .select("*, accounts(name, website, domain)")
    .eq("id", contactId)
    .single();
  if (error || !contact) throw new Error("Contact introuvable.");

  const { maxSearches } = getEnvConfig();

  // Adapte la forme attendue par enrichUserPrompt (champs « prospect »).
  const subject = {
    first_name: contact.first_name,
    last_name: contact.last_name,
    role: contact.role,
    company: contact.accounts?.name || "",
    company_website: contact.accounts?.website || "",
    linkedin_url: contact.linkedin_url || "",
    email: contact.email || "",
  };

  const { json: raw, usage, webSearchCount } = await callClaudeJson({
    system: enrichSystemPrompt(),
    user: enrichUserPrompt({ prospect: subject }),
    maxTokens: 1500,
    webSearch: true,
    maxSearches,
    model: MODEL_HAIKU,
  });

  const result = validateEnrich(raw);

  // Ne comble que les trous ; email_confidence/email_source toujours posés
  // (marqueur « déjà tenté » pour la dédup d'enfilement).
  const update = {
    email_confidence: result.email_confidence,
    email_source: result.email_source,
    updated_at: new Date().toISOString(),
  };
  if (result.email && !contact.email) update.email = result.email;
  if (result.phone && !contact.phone) update.phone = result.phone;

  const { data: saved, error: updateError } = await supabase
    .from("account_contacts")
    .update(update)
    .eq("id", contactId)
    .select()
    .single();
  if (updateError) throw new Error(updateError.message);

  await logAiRun({ route: "enrich_contact", accountId: contact.account_id, usage, webSearchCount, model: MODEL_HAIKU });

  return { contact: saved, enrichment: result };
}
