import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/prospects/export?format=csv (default) ou ?format=json
// Export de tous les prospects avec leur dernier score et statut.
// Utilisé pour alimenter Pipedrive, HubSpot, ou un tableur.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "csv";

  const supabase = getSupabase();

  const { data: prospects, error } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, role, company, company_website, email, phone, linkedin_url, status, fit_score, notes, created_at, account_id")
    .not("status", "in", '("opt-out")')
    .order("fit_score", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Dernière recherche par prospect (pour le résumé)
  const ids = (prospects || []).map((p) => p.id);
  const { data: researchRows } = ids.length
    ? await supabase
        .from("research")
        .select("prospect_id, summary, fit_score, created_at")
        .in("prospect_id", ids)
        .order("created_at", { ascending: false })
    : { data: [] };

  const researchMap = {};
  for (const r of researchRows || []) {
    if (!researchMap[r.prospect_id]) researchMap[r.prospect_id] = r;
  }

  const enriched = (prospects || []).map((p) => ({
    ...p,
    research_summary: researchMap[p.id]?.summary || "",
    research_date: researchMap[p.id]?.created_at?.slice(0, 10) || "",
  }));

  if (format === "json") {
    return NextResponse.json({ prospects: enriched, exported_at: new Date().toISOString() });
  }

  // ── Format CSV ──────────────────────────────────────────────────────────
  const HEADERS = [
    "id", "first_name", "last_name", "role", "company", "company_website",
    "email", "phone", "linkedin_url", "status", "fit_score",
    "research_summary", "research_date", "notes", "created_at",
  ];

  const escapeCell = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [
    HEADERS.join(","),
    ...enriched.map((p) =>
      HEADERS.map((h) => escapeCell(p[h])).join(",")
    ),
  ];

  const csv = lines.join("\r\n");
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fox-prospects-${today}.csv"`,
    },
  });
}
