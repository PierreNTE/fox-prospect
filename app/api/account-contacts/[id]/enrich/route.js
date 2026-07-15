import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { enrichSystemPrompt, enrichUserPrompt } from "@/lib/prompts-enrich";
import { validateEnrich } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { getEnvConfig, MODEL_HAIKU } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // recherche web (Fluid Compute)

// Enrichissement des coordonnées d'un contact de l'organigramme.
// Objectif produit : une fiche compte doit toujours offrir au moins une
// coordonnée exploitable. On réutilise le prompt d'enrichissement prospect,
// en fournissant l'entreprise = nom du compte.
export async function POST(_request, { params }) {
  const supabase = getSupabase();
  const { id } = params;

  const { data: contact, error } = await supabase
    .from("account_contacts")
    .select("*, accounts(name, website, domain)")
    .eq("id", id)
    .single();
  if (error || !contact) {
    return NextResponse.json({ error: "Contact introuvable." }, { status: 404 });
  }

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

  try {
    const { json: raw, usage, webSearchCount } = await callClaudeJson({
      system: enrichSystemPrompt(),
      user: enrichUserPrompt({ prospect: subject }),
      maxTokens: 1500,
      webSearch: true,
      maxSearches,
      model: MODEL_HAIKU,
    });

    const result = validateEnrich(raw);

    // Ne jamais écraser une coordonnée déjà présente : on ne comble que les trous.
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
      .eq("id", id)
      .select()
      .single();
    if (updateError) throw new Error(updateError.message);

    logAiRun({ route: "enrich_contact", accountId: contact.account_id, usage, webSearchCount, model: MODEL_HAIKU });

    return NextResponse.json({ contact: saved, enrichment: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
