import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { getSupabase } from "@/lib/supabase";
import { levenshtein, officialDomain } from "@/lib/call-brief";
import { normalizeName } from "@/lib/company-health";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SEARCH = "https://recherche-entreprises.api.gouv.fr/search";
const BAN = "https://api-adresse.data.gouv.fr/search/";
const CLIENT_CODES = new Set(["NOTE_STALE", "PHONE_AREA_MISMATCH"]);

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// POST /api/accounts/:id/sf-paste — contrôles de la fiche Salesforce collée.
// Corps : { code_postal, commune, rue, generic_emails[], domains[], flags[] }
// (données société et codes d'anomalie uniquement, analysés dans le navigateur).
// DELETE : oublie la fiche collée.
export async function POST(request, { params }) {
  const supabase = getSupabase();
  const body = await request.json().catch(() => ({}));
  const { data: a, error } = await supabase.from("accounts")
    .select("id, name, domain, website, web_intel, health_detail, found_email, found_email_source").eq("id", params.id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const d = a.health_detail || {};
  const cp = String(body.code_postal || "").replace(/\D/g, "").slice(0, 5);
  const commune = String(body.commune || "").slice(0, 60);
  const rue = String(body.rue || "").slice(0, 120);
  const flags = (Array.isArray(body.flags) ? body.flags : [])
    .filter((f) => CLIENT_CODES.has(f?.code)).map((f) => ({ code: f.code, detail: String(f.detail || "").slice(0, 160) }));

  // Adresse : un établissement de ce SIREN dans ce code postal ? Et la rue existe-t-elle dans la commune ?
  if (cp && d.siren) {
    try {
      const r = await getJson(`${SEARCH}?q=${d.siren}&code_postal=${cp}&page=1&per_page=1`);
      const hit = (r.results || []).find((x) => String(x.siren) === String(d.siren));
      if (!hit) {
        flags.push({ code: "ADDR_MISMATCH", detail: `Salesforce : ${cp} ${commune} · SIRENE : siège ${[d.siege_cp, d.commune].filter(Boolean).join(" ")}, aucun établissement à ce code postal` });
      } else {
        const etabs = (hit.matching_etablissements || []).filter((e) => String(e.code_postal) === cp);
        const secondary = etabs.length && etabs.every((e) => !e.est_siege);
        const assoc = hit.complements?.est_association || /^92/.test(String(hit.nature_juridique || ""));
        if (secondary && (assoc || (hit.nombre_etablissements_ouverts || 0) > 1 || d.groupe)) {
          flags.push({ code: "HQ_DECIDES", detail: `établissement de ${etabs[0].libelle_commune || cp}, siège à ${hit.siege?.libelle_commune || d.commune || "?"}` });
        }
      }
    } catch { /* API indisponible : contrôle sauté */ }
  }
  if (cp && rue) {
    try {
      const r = await getJson(`${BAN}?q=${encodeURIComponent(rue)}&postcode=${cp}&limit=1`);
      const f = (r.features || [])[0];
      const ok = f && f.properties?.score >= 0.5 && ["street", "housenumber", "locality"].includes(f.properties?.type);
      if (!ok) {
        const msg = `rue « ${rue.slice(0, 60)} » introuvable à ${cp}${commune ? ` ${commune}` : ""}`;
        const prev = flags.find((x) => x.code === "ADDR_MISMATCH");
        if (prev) prev.detail += ` ; ${msg}`; else flags.push({ code: "ADDR_MISMATCH", detail: msg });
      } else if (commune && normalizeName(f.properties.city) !== normalizeName(commune)) {
        const msg = `la rue est à ${f.properties.city}, pas à ${commune}`;
        const prev = flags.find((x) => x.code === "ADDR_MISMATCH");
        if (prev) prev.detail += ` ; ${msg}`; else flags.push({ code: "ADDR_MISMATCH", detail: msg });
      }
    } catch { /* API indisponible */ }
  }

  // Domaines d'email : faute de frappe proche du domaine officiel, ou domaine sans serveur mail.
  const official = officialDomain(a);
  const bad = [];
  for (const dom of (Array.isArray(body.domains) ? body.domains : []).slice(0, 8)) {
    const x = String(dom || "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
    if (!x || /(^|\.)(gmail|yahoo|hotmail|outlook|live|orange|wanadoo|free|sfr|laposte)\./.test(x)) continue;
    if (official && x !== official && levenshtein(x, official) <= 2) { bad.push(`${x} au lieu de ${official}`); continue; }
    const mx = await dns.resolveMx(x).catch(() => []);
    if (!mx.length) bad.push(`${x} sans serveur mail`);
  }
  if (bad.length) flags.push({ code: "EMAIL_DOMAIN_TYPO", detail: bad.join(" ; ") });

  const update = { sf_paste_flags: { at: new Date().toISOString(), code_postal: cp || null, commune: commune || null, rue: rue || null, flags } };
  // Email générique de la société vu dans Salesforce : utile s'il n'y en a pas d'autre.
  const generic = (Array.isArray(body.generic_emails) ? body.generic_emails : [])
    .map((e) => String(e).toLowerCase()).find((e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && !bad.some((b) => b.startsWith(e.split("@")[1])));
  if (generic && !a.found_email) {
    update.found_email = generic;
    update.found_email_source = "Salesforce (générique)";
  }
  const { error: e2 } = await supabase.from("accounts").update(update).eq("id", a.id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  return NextResponse.json({ ok: true, flags, email_saved: !!update.found_email });
}

export async function DELETE(_request, { params }) {
  const { error } = await getSupabase().from("accounts").update({ sf_paste_flags: null }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
