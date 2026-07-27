// Accès UNIFIÉ aux signaux d'achat — source de vérité : company_signals.
// Avant ce module, trois stockages coexistaient sans se parler :
//   research.signals (JSONB), accounts.signals (JSONB), company_signals (table).
// Les collecteurs gratuits (BOAMP, France Travail) écrivent company_signals ;
// ce module les fait ENFIN remonter dans la NBA, les priorités et le scoring.

// Normalise un signal (table ou JSONB) vers la forme attendue par lib/scoring.js
// et lib/nba.js : { type, detail, date, source, base_weight?, confidence? }.
function normalizeRow(s) {
  return {
    type: s.type || "autre",
    detail: s.detail || "",
    date: s.observed_at || s.date || "",
    source: s.source_url || s.source || "",
    base_weight: s.base_weight || undefined,
    confidence: s.confidence !== undefined && s.confidence !== null ? Number(s.confidence) : undefined,
  };
}

/**
 * Signaux company_signals pour un ensemble de comptes, groupés par account_id.
 * Une seule requête (pas de N+1). Fenêtre 12 mois : au-delà, la fraîcheur
 * exponentielle rend la contribution négligeable.
 *
 * @param {object} supabase
 * @param {string[]} accountIds — uuid des accounts
 * @param {number[]} [companyIds] — ids companies correspondants (optionnel)
 * @returns {Promise<Map<string, object[]>>} account_id → signaux normalisés
 */
export async function getCompanySignalsByAccount(supabase, accountIds, companyIds = []) {
  const byAccount = new Map();
  if (!accountIds?.length && !companyIds?.length) return byAccount;

  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ors = [];
  if (accountIds?.length) ors.push(`account_id.in.(${accountIds.join(",")})`);
  if (companyIds?.length) ors.push(`company_id.in.(${companyIds.join(",")})`);

  const { data } = await supabase
    .from("company_signals")
    .select("account_id, company_id, type, detail, observed_at, source_url, base_weight, confidence")
    .or(ors.join(","))
    .gte("observed_at", since)
    .neq("status", "écarté")
    .order("observed_at", { ascending: false })
    .limit(500);

  for (const s of data || []) {
    const key = s.account_id || `company:${s.company_id}`;
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(normalizeRow(s));
  }
  return byAccount;
}

/**
 * Ingestion en LOT de signaux collectés (BOAMP, France Travail…).
 * Remplace le N+1 des collecteurs (2-3 requêtes par signal) par 3 requêtes :
 *   1. tous les comptes (id, name, company_id) — matching en mémoire ;
 *   2. dédup par source_url en une requête in() ;
 *   3. insert en lot.
 * Chaque signal attendu : { company_name, type, detail, observed_at, source_url,
 * base_weight, confidence }. Rattache par account_id même sans SIREN résolu
 * (colonne company_signals.account_id, migration-v7).
 *
 * @returns {{ inserted: number, skipped: number, total: number }}
 */
export async function ingestSignals(supabase, signals) {
  if (!signals?.length) return { inserted: 0, skipped: 0, total: 0 };

  // 1. Matching comptes en mémoire (nom normalisé, correspondance par inclusion).
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, company_id")
    .limit(5000);
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const accountList = (accounts || []).map((a) => ({ ...a, n: norm(a.name) })).filter((a) => a.n);

  const matchAccount = (name) => {
    const n = norm(name);
    if (!n) return null;
    // Nom exact d'abord, puis inclusion dans les deux sens (le plus long gagne).
    return (
      accountList.find((a) => a.n === n) ||
      accountList
        .filter((a) => n.includes(a.n) || a.n.includes(n))
        .sort((a, b) => b.n.length - a.n.length)[0] ||
      null
    );
  };

  const matched = [];
  let skipped = 0;
  for (const s of signals) {
    const account = matchAccount(s.company_name);
    if (!account) { skipped++; continue; }
    matched.push({ signal: s, account });
  }
  if (!matched.length) return { inserted: 0, skipped, total: signals.length };

  // 2. Dédup par source_url en une requête.
  const urls = [...new Set(matched.map((m) => m.signal.source_url).filter(Boolean))];
  let known = new Set();
  if (urls.length) {
    const { data: existing } = await supabase
      .from("company_signals")
      .select("source_url")
      .in("source_url", urls);
    known = new Set((existing || []).map((e) => e.source_url));
  }

  // 3. Insert en lot (l'index unique partiel sur source_url couvre les races).
  const seen = new Set();
  const rows = [];
  for (const { signal: s, account } of matched) {
    if (s.source_url && (known.has(s.source_url) || seen.has(s.source_url))) { skipped++; continue; }
    if (s.source_url) seen.add(s.source_url);
    rows.push({
      company_id: account.company_id ?? null,
      account_id: account.id,
      type: s.type,
      detail: s.detail,
      observed_at: s.observed_at,
      source_url: s.source_url || null,
      source_verified: false,
      confidence: s.confidence ?? 1.0,
      base_weight: s.base_weight ?? 0,
      status: "nouveau",
    });
  }
  if (!rows.length) return { inserted: 0, skipped, total: signals.length };

  const { error, data } = await supabase.from("company_signals").insert(rows).select("id");
  if (error) return { inserted: 0, skipped: skipped + rows.length, total: signals.length };
  return { inserted: data?.length ?? rows.length, skipped, total: signals.length };
}

/**
 * Fusionne signaux entreprise (table) et signaux de qualification (JSONB research),
 * dédupliqués par (type + detail) — le signal daté/tablé prime sur le JSONB.
 */
export function mergeSignals(companySignals = [], researchSignals = []) {
  const seen = new Set();
  const out = [];
  for (const s of [...companySignals, ...researchSignals]) {
    const n = s.observed_at || s.source_url ? normalizeRow(s) : { ...s };
    const key = `${n.type}|${(n.detail || "").slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
