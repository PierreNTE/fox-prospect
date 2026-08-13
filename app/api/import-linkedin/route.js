import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { linkedinImportSystemPrompt, linkedinImportUserPrompt } from "@/lib/prompts-enrich";
import { validateLinkedinImport } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { getEnvConfig, MODEL_HAIKU } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // recherche web (Fluid Compute : jusqu'à 300 s même en Hobby)

export async function POST(request) {
  const { linkedinUrl } = await request.json();
  const url = (linkedinUrl || "").trim();

  if (!/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+/i.test(url)) {
    return NextResponse.json(
      { error: "URL LinkedIn invalide : attendu un profil du type https://www.linkedin.com/in/..." },
      { status: 400 }
    );
  }

  const { maxSearches } = getEnvConfig();

  // Kill-switch budget mensuel : coupe net si la dépense Anthropic du mois a
  // atteint MONTHLY_BUDGET_EUR (reprise automatique au 1er du mois suivant).
  const budgetState = await checkMonthlyBudget(getSupabase());
  if (budgetState.exceeded) {
    return NextResponse.json({ error: budgetMessage(budgetState) }, { status: 429 });
  }

  try {
    const { json: raw, usage, webSearchCount } = await callClaudeJson({
      system: linkedinImportSystemPrompt(),
      user: linkedinImportUserPrompt({ linkedinUrl: url }),
      maxTokens: 1200,
      webSearch: true,
      maxSearches,
      model: MODEL_HAIKU,
    });

    const result = validateLinkedinImport(raw);

    await logAiRun({ route: "import-linkedin", usage, webSearchCount, model: MODEL_HAIKU });

    return NextResponse.json({
      prospect: {
        first_name: result.first_name,
        last_name: result.last_name,
        role: result.role,
        company: result.company,
        company_website: result.company_website,
        linkedin_url: url,
        email: "",
        phone: "",
      },
      confidence: result.confidence,
      notes: result.notes,
      sources: result.sources,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
