import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listProspects } from "@/lib/data";
import { resolveSiren, upsertCompany } from "@/lib/sirene";

export const dynamic = "force-dynamic";

// Rafraîchissement client de la liste (le 1er rendu vient du serveur via lib/data).
// ?offset=N&limit=M pour charger la suite (pagination serveur du « Voir plus »).
export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const limit = Math.min(Number(sp.get("limit")) || 500, 1000);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  return NextResponse.json({ prospects: await listProspects(getSupabase(), { limit, offset }) });
}

export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  const rows = Array.isArray(body) ? body : [body];

  // Requêtes de dédup BORNÉES par le contenu de l'import (l'ancien code
  // chargeait toute la table prospects — O(n) mémoire, mort à l'échelle).
  const emails = [...new Set(rows.map((r) => (r.email || "").trim().toLowerCase()).filter(Boolean))];
  const companies = [...new Set(rows.map((r) => (r.company || "").trim()).filter(Boolean))];

  // Liste d'opposition, BORNÉE aux emails du fichier. L'appel précédent
  // chargeait toute la table optout — même défaut d'échelle que la dédup
  // ci-dessous, corrigé plus tard mais pas ici.
  const { data: optouts } = emails.length
    ? await supabase.from("optout").select("email").in("email", emails)
    : { data: [] };
  const blocked = new Set((optouts || []).map((o) => o.email.toLowerCase()));

  // Dédoublonnage CIBLÉ contre l'existant (même email, ou même nom+entreprise) :
  // on ne charge que les lignes susceptibles de matcher le fichier importé
  // (emails et entreprises du fichier, casse d'origine + minuscules) au lieu de
  // la table entière — l'import reste rapide quelle que soit la taille de la
  // base. La comparaison finale reste insensible à la casse (en JS).
  // On garde l'id du prospect existant pour que l'appelant puisse rebondir
  // dessus (ex. fiche compte : rattacher/ouvrir la fiche au lieu d'échouer).
  const fileEmails = [...new Set(rows.flatMap((r) => {
    const e = (r.email || "").trim();
    return e ? [e, e.toLowerCase()] : [];
  }))];
  const fileCompanies = [...new Set(rows.flatMap((r) => {
    const c = (r.company || "").trim();
    return c ? [c, c.toLowerCase()] : [];
  }))];
  const [byEmail, byCompany] = await Promise.all([
    fileEmails.length
      ? supabase.from("prospects").select("id, email, first_name, last_name, company").in("email", fileEmails)
      : Promise.resolve({ data: [] }),
    fileCompanies.length
      ? supabase.from("prospects").select("id, email, first_name, last_name, company").in("company", fileCompanies)
      : Promise.resolve({ data: [] }),
  ]);
  const emailToId = new Map();
  const personToId = new Map();
  for (const p of [...(byEmail.data || []), ...(byCompany.data || [])]) {
    if (p.email) emailToId.set(p.email.toLowerCase(), p.id);
    personToId.set(`${p.first_name}|${p.last_name}|${p.company}`.toLowerCase(), p.id);
  }

  const normalizeUrl = (u) => {
    const v = (u || "").trim();
    if (!v) return "";
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  };

  const seen = new Set(); // doublons à l'intérieur du fichier importé lui-même
  const clean = [];
  let duplicates = 0;
  let noContact = 0; // lignes refusées : aucune coordonnée exploitable
  const duplicateIds = []; // ids des prospects existants correspondants

  for (const r of rows) {
    if (!r.company || (!r.first_name && !r.last_name)) continue;
    const email = (r.email || "").trim().toLowerCase();
    if (email && blocked.has(email)) continue;

    // Règle produit : un prospect injoignable (ni email, ni téléphone, ni
    // LinkedIn) n'entre pas dans la liste — il pollue le funnel sans être
    // actionnable. Enrichir d'abord (organigramme), importer ensuite.
    if (!email && !(r.phone || "").trim() && !(r.linkedin_url || "").trim()) {
      noContact++;
      continue;
    }

    const personKey = `${r.first_name || ""}|${r.last_name || ""}|${r.company}`.toLowerCase();
    const existingId = (email && emailToId.get(email)) || personToId.get(personKey) || null;
    if (existingId || seen.has(personKey)) {
      duplicates++;
      if (existingId) duplicateIds.push(existingId);
      continue;
    }
    seen.add(personKey);

    clean.push({
      first_name: (r.first_name || "").trim(),
      last_name: (r.last_name || "").trim(),
      role: (r.role || "").trim(),
      company: (r.company || "").trim(),
      company_website: normalizeUrl(r.company_website),
      linkedin_url: normalizeUrl(r.linkedin_url),
      // Email stocké en MINUSCULES (S1) : toute la dédup compare en minuscules,
      // stocker la casse d'origine laissait passer « Jean@x.fr » face à
      // « jean@x.fr » déjà en base.
      email: (r.email || "").trim().toLowerCase(),
      phone: (r.phone || "").trim(),
      // Rattachement direct fourni par l'appelant (ex. conversion depuis la
      // fiche compte) : évite le matching par nom plus bas.
      ...(r.account_id ? { account_id: r.account_id } : {}),
    });
  }

  if (clean.length === 0) {
    return NextResponse.json(
      {
        error: duplicates
          ? `Aucun nouveau prospect : ${duplicates} doublon(s) déjà dans les prospects.`
          : noContact
            ? `Aucun nouveau prospect : ${noContact} ligne(s) sans aucune coordonnée (email, téléphone ou LinkedIn requis).`
            : "Aucune ligne valide (entreprise + nom requis, opt-out exclus).",
        duplicates,
        duplicate_ids: duplicateIds,
        no_contact: noContact,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.from("prospects").insert(clean).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rattachement automatique à un compte (créé si absent), en requêtes GROUPÉES.
  // L'ancien code faisait 2-3 requêtes séquentielles PAR prospect (20-40 s pour
  // 200 lignes). La table accounts est petite → chargée entière (2 colonnes)
  // pour matcher insensible à la casse, comme l'ilike d'origine.
  const toAttach = data.filter((p) => !p.account_id && (p.company || "").trim());
  if (toAttach.length > 0) {
    const { data: accs } = await supabase.from("accounts").select("id, name");
    const accByName = new Map((accs || []).map((a) => [a.name.toLowerCase(), a.id]));

    // Comptes manquants : un seul insert multiple (dédupliqués par nom).
    const missing = [...new Map(
      toAttach
        .map((p) => p.company.trim())
        .filter((name) => !accByName.has(name.toLowerCase()))
        .map((name) => [name.toLowerCase(), name])
    ).values()];
    if (missing.length > 0) {
      const websiteByCompany = new Map(
        toAttach.map((p) => [p.company.trim().toLowerCase(), p.company_website || ""])
      );
      const { data: created } = await supabase
        .from("accounts")
        .insert(missing.map((name) => ({ name, website: websiteByCompany.get(name.toLowerCase()) || "" })))
        .select("id, name");
      for (const a of created || []) accByName.set(a.name.toLowerCase(), a.id);

      // Couplage accounts→companies (S1) : la résolution SIREN est lancée sans
      // être attendue — le compte est rattaché quand elle aboutit, l'import
      // n'est jamais ralenti par elle.
      //
      // Une fois par compte CRÉÉ, et non par ligne du fichier comme dans la
      // version d'origine : importer trente contacts d'une même entreprise
      // déclenchait trente résolutions pour le même SIREN.
      for (const a of created || []) {
        const domain = (websiteByCompany.get(a.name.toLowerCase()) || "")
          .replace(/^https?:\/\//, "")
          .replace(/\/.*$/, "");
        resolveSiren({ name: a.name, domain })
          .then(async (sirene) => {
            if (!sirene) return;
            const companyId = await upsertCompany(supabase, sirene, domain ? { domain } : {});
            if (companyId) {
              await supabase.from("accounts").update({ company_id: companyId }).eq("id", a.id);
            }
          })
          .catch(() => {});
      }
    }

    // Un update groupé par compte (au lieu d'un par prospect).
    const idsByAccount = new Map();
    for (const p of toAttach) {
      const accountId = accByName.get(p.company.trim().toLowerCase());
      if (!accountId) continue;
      if (!idsByAccount.has(accountId)) idsByAccount.set(accountId, []);
      idsByAccount.get(accountId).push(p.id);
    }
    for (const [accountId, ids] of idsByAccount) {
      await supabase.from("prospects").update({ account_id: accountId }).in("id", ids);
    }
  }

  return NextResponse.json({
    inserted: data.length,
    skipped: rows.length - clean.length,
    duplicates,
    no_contact: noContact,
    duplicate_ids: duplicateIds,
    // Ids créés : permet à l'appelant d'ouvrir directement la fiche.
    created: data.map((p) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name })),
  });
}
