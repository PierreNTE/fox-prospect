// Lecture de l'export « Printable View » d'une liste de leads Salesforce (PDF).
//
// Le PDF n'a pas de structure de tableau exploitable : c'est du texte positionné.
// On reconstruit les lignes à partir des positions :
//   - les colonnes sont repérées par les intitulés d'en-tête (page 1) ;
//   - chaque lead a exactement une « Created Date » sur une seule ligne, qui sert
//     d'ancre verticale ; les cellules multi-lignes (« ENT France / Associates »)
//     sont rattachées à l'ancre la plus proche.
//
// Fonctions pures, sans dépendance au moteur PDF : l'extraction des items
// (texte + x + y depuis le haut de la page) est faite par l'appelant (unpdf).

const HEADERS = [
  ["name", "Name"],
  ["status", "Lead Status"],
  ["type", "Lead Type"],
  ["account", "Account"],
  ["buyer", "Buyer Lever"],
  ["owner", "Account Owner"],
  ["company", "Company"],
  ["created", "Created Date"],
  ["campaign_short", "Campaign Short Name"],
  ["campaign", "Campaign"],
];

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

/** Repère les colonnes à partir de la ligne d'en-tête. null si absente. */
export function detectColumns(items) {
  const byLabel = new Map();
  for (const it of items) {
    const s = it.str.trim();
    if (!byLabel.has(s)) byLabel.set(s, it);
  }
  const company = byLabel.get("Company");
  const created = byLabel.get("Created Date");
  if (!company || !created) return null;
  const headerY = created.y;
  const cols = [];
  for (const [key, label] of HEADERS) {
    const it = items.find((i) => i.str.trim() === label && Math.abs(i.y - headerY) < 2);
    if (it) cols.push({ key, x: it.x });
  }
  cols.sort((a, b) => a.x - b.x);
  return { headerY, cols };
}

function columnOf(x, cols) {
  let key = null;
  for (const c of cols) {
    if (x >= c.x - 2) key = c.key;
    else break;
  }
  return key;
}

/**
 * @param {{height:number, items:{str:string,x:number,y:number}[]}[]} pages
 * @returns {{ rows: object[], total: number|null }}
 */
export function parseLeadPages(pages) {
  let layout = null;
  let total = null;
  const rows = [];

  for (const page of pages) {
    const items = page.items.filter((i) => i.str && i.str.trim());
    const detected = detectColumns(items);
    if (detected) layout = detected;
    if (!layout) continue;

    const m = items.find((i) => i.str.trim() === "Number of records");
    if (m) {
      const n = items.find((i) => Math.abs(i.y - m.y) < 2 && /^\d[\d\s,.]*$/.test(i.str.trim()));
      if (n) total = Number(n.str.replace(/\D/g, ""));
    }

    const top = detected ? detected.headerY + 4 : 28;
    const bottom = (page.height || 792) - 25;
    const body = items.filter((i) => i.y > top && i.y < bottom);
    const createdX = layout.cols.find((c) => c.key === "created")?.x ?? 0;

    const anchors = body
      .filter((i) => DATE_RE.test(i.str.trim()) && Math.abs(i.x - createdX) < 8)
      .sort((a, b) => a.y - b.y);

    anchors.forEach((a, idx) => {
      const lo = idx > 0 ? (a.y + anchors[idx - 1].y) / 2 : a.y - 12;
      const hi = idx + 1 < anchors.length ? (a.y + anchors[idx + 1].y) / 2 : a.y + 12;
      const cells = {};
      body
        .filter((i) => i.y >= lo && i.y < hi)
        .sort((p, q) => p.y - q.y || p.x - q.x)
        .forEach((i) => {
          const k = columnOf(i.x, layout.cols);
          if (!k) return;
          cells[k] = cells[k] ? `${cells[k]} ${i.str.trim()}` : i.str.trim();
        });
      rows.push(cells);
    });
  }

  return { rows: rows.map(normalizeRow), total };
}

function normalizeRow(c) {
  const company = (c.company || c.account || "").replace(/\s+/g, " ").trim();
  return {
    company,
    account: (c.account || "").replace(/\s+/g, " ").trim(),
    status: (c.status || "").replace(/\s+/g, " ").trim(),
    contact: c.name && c.name !== "Outbound Lead" ? c.name.trim() : "",
    created: usDateToIso(c.created),
    campaign: (c.campaign_short || "").replace(/\s+/g, " ").trim(),
  };
}

// Salesforce (locale US) : MM/DD/YYYY.
export function usDateToIso(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s || "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/**
 * Nettoie un nom de société Salesforce pour la recherche SIRENE.
 * « MBF PLASTIQUES (Oyonnax) » → { query: "MBF PLASTIQUES", hint: "Oyonnax" }
 * « AUTOROUTE ESTEREL [DMU] » → { query: "AUTOROUTE ESTEREL", hint: "" }
 */
export function cleanCompanyName(raw) {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  const hints = [...s.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
  const query = s
    .replace(/\[[^\]]*\]?/g, " ")
    .replace(/\([^)]*\)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { query: query || s, hint: hints.join(" ") };
}

/**
 * Une ligne par société (le même compte apparaît une fois par contact importé).
 * On garde le statut le plus « vivant » : New > Working > Closed.
 */
export function dedupeByCompany(rows) {
  const rank = (st) => (/^new/i.test(st) ? 0 : /^working/i.test(st) ? 1 : 2);
  const map = new Map();
  for (const r of rows) {
    if (!r.company) continue;
    const key = r.company.toLowerCase();
    const prev = map.get(key);
    if (!prev) map.set(key, { ...r, contacts: r.contact ? 1 : 0, leads: 1 });
    else {
      prev.leads += 1;
      if (r.contact) prev.contacts += 1;
      if (rank(r.status) < rank(prev.status)) {
        prev.status = r.status;
        prev.campaign = r.campaign || prev.campaign;
      }
    }
  }
  return [...map.values()];
}
