import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listSalesforceLeads } from "@/lib/leads-import";
import { buildExportRows, toCsv } from "@/lib/sales-chat";

export const dynamic = "force-dynamic";

// GET /api/leads/export — fichier de la semaine pour l'agent Sales Chat.
//   ?all=1  : inclut les leads déjà exportés ces 25 derniers jours
//   ?mark=1 : note l'export sur les leads (ils ne repartent pas la semaine suivante)
//   ?format=json : aperçu (compteurs) sans fichier
export async function GET(request) {
  const url = new URL(request.url);
  const supabase = getSupabase();
  const leads = await listSalesforceLeads(supabase);
  const rows = buildExportRows(leads, { baseUrl: url.origin, all: url.searchParams.get("all") === "1" });

  if (url.searchParams.get("format") === "json") {
    const by = (c) => rows.filter((r) => r.confiance_email === c).length;
    const missing = by("à trouver");
    const open = leads.filter((l) => ["active", "vigilance"].includes(l.health_status) && !/closed/i.test(l.sf_lead_status || ""));
    return NextResponse.json({
      rows: rows.length, sur: by("sûr"), probable: by("probable"), suppose: by("supposé"),
      sans_email: missing,
      deja_exportes: open.filter((l) => l.email_exported_at).length,
    });
  }

  if (url.searchParams.get("mark") === "1" && rows.length) {
    const now = new Date().toISOString();
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      await supabase.from("accounts").update({ email_exported_at: now }).in("id", ids.slice(i, i + 200));
    }
  }
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-sales-chat-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
