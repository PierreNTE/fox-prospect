import { NextResponse } from "next/server";
import { callClaudeJson } from "@/lib/anthropic";
import { linkedinImportSystemPrompt, linkedinImportUserPrompt } from "@/lib/prompts-enrich";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // recherche web (Fluid Compute : jusqu'à 300 s même en Hobby)

export async function POST(request) {
  const { linkedinUrl } = await request.json();
  const url = (linkedinUrl || "").trim();

  if (!/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+/i.test(url)) {
    return NextResponse.json(
      { error: "URL LinkedIn invalide : attendu un profil du type https://www.linkedin.com/in/..." },
      { status: 400 }
    );
  }

  try {
    const { json: result } = await callClaudeJson({
      system: linkedinImportSystemPrompt(),
      user: linkedinImportUserPrompt({ linkedinUrl: url }),
      maxTokens: 1200,
      webSearch: true,
      maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 4,
    });

    return NextResponse.json({
      prospect: {
        first_name: result.first_name || "",
        last_name: result.last_name || "",
        role: result.role || "",
        company: result.company || "",
        company_website: result.company_website || "",
        linkedin_url: url,
        email: "",
      },
      confidence: result.confidence || "basse",
      notes: result.notes || "",
      sources: result.sources || [],
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
