// Enrichissement email DÉTERMINISTE (S2) — remplace l'appel LLM + web_search
// pour le cas nominal. Le LLM « devinait » ce que ce code calcule mieux :
//   1. domaine ← site web de l'entreprise (ou du compte) ;
//   2. pattern ← appris sur les collègues déjà en base (même domaine) ;
//   3. candidat ← pattern appliqué (accents supprimés, règles FR) ;
//   4. MX ← le domaine reçoit-il des emails ?
// Le LLM ne reste qu'en repli quand aucun domaine n'est connu (~10 % des cas).
// Portage JS de la logique validée dans scripts/contact-sources/waterfall.py.

import { promises as dns } from "node:dns";

// « Éric De-La-Tour » → "eric-de-la-tour" (accents supprimés — convention des
// emails français — tirets conservés, tout le reste retiré).
export function normalizeNamePart(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .replace(/^-+|-+$/g, "");
}

// Patterns d'adressage observés dans les entreprises françaises,
// du plus courant au plus rare.
export const EMAIL_PATTERNS = Object.freeze([
  "prenom.nom", "pnom", "p.nom", "prenomnom", "prenom", "nom.prenom",
]);

export function applyPattern(pattern, firstName, lastName) {
  const p = normalizeNamePart(firstName);
  const n = normalizeNamePart(lastName);
  if (!p || !n) return null;
  switch (pattern) {
    case "prenom.nom": return `${p}.${n}`;
    case "pnom": return `${p[0]}${n}`;
    case "p.nom": return `${p[0]}.${n}`;
    case "prenomnom": return `${p}${n}`;
    case "prenom": return p;
    case "nom.prenom": return `${n}.${p}`;
    default: return null;
  }
}

// Étant donné l'email connu d'un collègue et son nom, retrouve le pattern.
export function detectPattern(email, firstName, lastName) {
  const local = (email || "").toLowerCase().split("@")[0];
  if (!local) return null;
  for (const pattern of EMAIL_PATTERNS) {
    if (applyPattern(pattern, firstName, lastName) === local) return pattern;
  }
  return null;
}

// "https://www.acme.fr/contact" → "acme.fr" ; tolère un domaine nu.
export function extractDomain(input) {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

export async function hasMx(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

/**
 * Enrichissement déterministe. Renvoie null si non applicable (pas de domaine,
 * pas de nom, ou domaine sans MX) → l'appelant retombe sur le LLM.
 *
 * @returns {Promise<null | { email, email_confidence, email_source, pattern }>}
 */
export async function deterministicEnrich(supabase, prospect) {
  // 1. Domaine : site web du prospect, sinon domaine/site du compte rattaché.
  let domain = extractDomain(prospect.company_website);
  if (!domain && prospect.account_id) {
    const { data: account } = await supabase
      .from("accounts")
      .select("domain, website")
      .eq("id", prospect.account_id)
      .maybeSingle();
    domain = extractDomain(account?.domain) || extractDomain(account?.website);
  }
  if (!domain) return null;

  // 2. Pattern appris sur les collègues déjà en base (même domaine email).
  const { data: colleagues } = await supabase
    .from("prospects")
    .select("first_name, last_name, email")
    .ilike("email", `%@${domain}`)
    .neq("id", prospect.id)
    .limit(20);

  let learnedPattern = null;
  for (const c of colleagues || []) {
    const p = detectPattern(c.email, c.first_name, c.last_name);
    if (p) { learnedPattern = p; break; }
  }

  // 3. Candidat.
  const pattern = learnedPattern || "prenom.nom";
  const local = applyPattern(pattern, prospect.first_name, prospect.last_name);
  if (!local) return null;

  // 4. Le domaine doit recevoir des emails.
  if (!(await hasMx(domain))) return null;

  return {
    email: `${local}@${domain}`,
    email_confidence: learnedPattern ? "moyenne" : "déduit",
    email_source: learnedPattern
      ? `Pattern « ${pattern} » confirmé par un collègue en base (@${domain}), MX vérifié.`
      : `Pattern par défaut « prenom.nom » appliqué à @${domain} (MX vérifié) — non confirmé.`,
    pattern,
  };
}
