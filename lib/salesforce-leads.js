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

// Intitulés reconnus, en anglais et en français (l'interface Salesforce suit la
// langue de l'utilisateur). Comparaison sans accents ni casse, sur le début du texte.
const HEADERS = [
  ["campaign_short", /^(campaign short name|nom court de (la )?campagne)/],
  ["campaign", /^(campaign|campagne)/],
  ["status", /^(lead status|statut( du lead| de la piste)?$|statut)/],
  ["type", /^(lead type|type( de lead| de piste)?$)/],
  ["owner", /^(account owner|proprietaire|lead owner)/],
  ["buyer", /^(buyer lever|buyer)/],
  ["company", /^(company|societe|entreprise|raison sociale)/],
  ["account", /^(account|compte)$/],
  ["created", /^(created date|created|date de creation|cree le|date)/],
  ["name", /^(name|nom)$/],
];

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{4}-\d{2}-\d{2}$/;

const norm = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Fusionne les fragments d'une même ligne très proches (« Created » + « Date »),
 * certains moteurs PDF découpant un intitulé en plusieurs morceaux.
 */
function mergeLine(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    const prevEnd = prev ? prev.x + (prev.w ?? prev.str.length * 2.6) : 0;
    if (prev && Math.abs(prev.y - it.y) < 1.5 && it.x - prevEnd < 2 && it.x >= prev.x) {
      prev.str = `${prev.str} ${it.str}`.replace(/\s+/g, " ");
      prev.w = it.x + (it.w ?? it.str.length * 2.6) - prev.x;
    } else out.push({ ...it });
  }
  return out;
}

/** Repère les colonnes à partir de la ligne d'en-tête. null si absente. */
export function detectColumns(items) {
  const merged = mergeLine(items);
  // Ligne d'en-tête = la ligne qui porte un intitulé « société » ET un autre intitulé connu.
  for (const cand of merged.filter((i) => HEADERS.find(([k]) => k === "company")[1].test(norm(i.str)))) {
    const line = merged.filter((i) => Math.abs(i.y - cand.y) < 6);
    const cols = [];
    const used = new Set();
    for (const it of line.sort((a, b) => a.x - b.x)) {
      const t = norm(it.str);
      if (t.length > 30) continue;
      const hit = HEADERS.find(([k, re]) => !used.has(k) && re.test(t));
      if (hit) { used.add(hit[0]); cols.push({ key: hit[0], x: it.x }); }
    }
    // Au moins 3 intitulés reconnus dont société + (date ou statut) : une ligne
    // de données contenant « Société Générale » ne doit pas passer pour un en-tête.
    if (used.size >= 3 && (used.has("created") || used.has("status"))) {
      cols.sort((a, b) => a.x - b.x);
      return { headerY: Math.max(...line.map((i) => i.y)), cols };
    }
  }
  return null;
}

// Ordre de lecture : lignes visuelles (à ±2,5 pt près — l'OCR n'aligne pas
// parfaitement les mots), puis de gauche à droite dans chaque ligne.
function inReadingOrder(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const lines = [];
  for (const it of sorted) {
    const l = lines[lines.length - 1];
    if (l && it.y - l.y0 < 2.5) l.items.push(it);
    else lines.push({ y0: it.y, items: [it] });
  }
  return lines.flatMap((l) => l.items.sort((a, b) => a.x - b.x));
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
 * @param {{height:number, items:{str:string,x:number,y:number,w?:number}[]}[]} pages
 * @returns {{ rows: object[], total: number|null, diagnostic: object }}
 */
export function parseLeadPages(pages) {
  let layout = null;
  let total = null;
  const rows = [];
  let textItems = 0;

  for (const page of pages) {
    const items = page.items.filter((i) => i.str && i.str.trim());
    textItems += items.length;
    let detected = detectColumns(items);
    // Une page suivante ne remplace la mise en page que par un en-tête aussi complet.
    if (detected && layout && detected.cols.length < layout.cols.length) detected = null;
    if (detected) layout = detected;
    if (!layout) continue;

    const m = items.find((i) => /^(number of records|nombre d.enregistrements)/.test(norm(i.str)));
    if (m) {
      const n = items.find((i) => Math.abs(i.y - m.y) < 2 && /^\d[\d\s,.\u202f]*$/.test(i.str.trim()));
      if (n) total = Number(n.str.replace(/\D/g, ""));
    }

    const top = detected ? detected.headerY + 4 : 28;
    const bottom = (page.height || 792) - 25;
    const body = items.filter((i) => i.y > top && i.y < bottom);

    // Ancre verticale d'une ligne : la date de création (une seule ligne par lead) ;
    // à défaut, le premier fragment de la colonne société.
    const createdX = layout.cols.find((c) => c.key === "created")?.x;
    let anchors = createdX == null ? [] : body
      .filter((i) => DATE_RE.test(i.str.trim()) && columnOf(i.x, layout.cols) === "created")
      .sort((a, b) => a.y - b.y);
    if (!anchors.length) {
      const comp = body.filter((i) => columnOf(i.x, layout.cols) === "company").sort((a, b) => a.y - b.y);
      anchors = comp.filter((c, idx) => idx === 0 || c.y - comp[idx - 1].y > 9);
    }

    anchors.forEach((a, idx) => {
      const lo = idx > 0 ? (a.y + anchors[idx - 1].y) / 2 : a.y - 12;
      const hi = idx + 1 < anchors.length ? (a.y + anchors[idx + 1].y) / 2 : a.y + 12;
      const cells = {};
      inReadingOrder(body.filter((i) => i.y >= lo && i.y < hi))
        .forEach((i) => {
          const k = columnOf(i.x, layout.cols);
          if (!k) return;
          cells[k] = cells[k] ? `${cells[k]} ${i.str.trim()}` : i.str.trim();
        });
      rows.push(cells);
    });
  }

  const sample = (pages[0]?.items || [])
    .filter((i) => i.str && i.str.trim())
    .slice(0, 25)
    .map((i) => i.str.trim().slice(0, 40));
  return {
    rows: rows.map(normalizeRow).filter((r) => r.company),
    total,
    diagnostic: { pages: pages.length, textItems, headerFound: !!layout, columns: layout?.cols.map((c) => c.key) || [], sample },
  };
}

// Statuts Salesforce connus. Une cellule coupée par la mise en page du PDF
// (« N », « Work », « Closed by ») est ramenée au statut complet.
const KNOWN_STATUSES = ["New", "Working", "Closed by Sales", "Nurture", "Converted", "Qualified", "Unqualified"];

/** Statut Salesforce normalisé (pur, testé). Inconnu → laissé tel quel. */
export function normalizeLeadStatus(raw) {
  const v = String(raw || "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const low = v.toLowerCase();
  const exact = KNOWN_STATUSES.find((k) => k.toLowerCase() === low);
  if (exact) return exact;
  const prefix = KNOWN_STATUSES.find((k) => k.toLowerCase().startsWith(low));
  if (prefix) return prefix;
  if (/^closed/i.test(v)) return "Closed by Sales";
  return v;
}

function normalizeRow(c) {
  const company = (c.company || c.account || "").replace(/\s+/g, " ").trim();
  return {
    company,
    account: (c.account || "").replace(/\s+/g, " ").trim(),
    status: normalizeLeadStatus(c.status),
    contact: c.name && c.name !== "Outbound Lead" ? c.name.trim() : "",
    created: usDateToIso(c.created),
    campaign: (c.campaign_short || "").replace(/\s+/g, " ").trim(),
  };
}

// Salesforce (locale US) : MM/DD/YYYY.
export function usDateToIso(s) {
  const v = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/**
 * Liste collée à la main : une société par ligne, ou un tableau copié depuis
 * Salesforce / Excel. Si la première ligne porte des intitulés, on prend la
 * colonne société (Company / Société / Account / Compte) et le statut s'il existe ;
 * sinon la première colonne.
 */
export function parsePastedCompanies(text) {
  const lines = (text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l) => l.split(/\t|;/).map((c) => c.replace(/^"|"$/g, "").replace(/\s+/g, " ").trim());
  const head = split(lines[0]).map(norm);
  const find = (re) => head.findIndex((h) => re.test(h));
  let col = find(/^(company|societe|entreprise|raison sociale)$/);
  if (col < 0) col = find(/^(account( name)?|compte|nom du compte)$/);
  const statusCol = find(/^(lead status|statut)/);
  const campaignCol = find(/^(campaign short name|campaign|campagne)/);
  const hasHeader = col >= 0 || statusCol >= 0;
  if (col < 0) col = 0;

  const seen = new Set();
  const out = [];
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = split(line);
    const name = (cells[col] || "").slice(0, 200);
    if (!name || /^(outbound|inbound) lead$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      company: name,
      status: normalizeLeadStatus(statusCol >= 0 && cells[statusCol]) || "New",
      campaign: (campaignCol >= 0 && cells[campaignCol]) || "",
      contact: "",
      account: name,
      created: null,
    });
  }
  return out;
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

/**
 * OCR → items positionnés, au format attendu par parseLeadPages.
 * Certains pilotes d'impression (« Microsoft Print to PDF ») transforment le
 * texte en dessins : le PDF n'a plus aucun caractère. On le relit par OCR, puis
 * on recolle les mots d'une même cellule (écart inférieur à ~0,7 × la hauteur
 * des lettres) pour retrouver des fragments comparables à ceux d'un vrai PDF.
 *
 * @param {{text:string, bbox:{x0:number,y0:number,x1:number,y1:number}, baseline?:{y0:number,y1:number}}[]} words  pixels
 * @param {number} scale  pixels par point PDF
 */
export function ocrWordsToItems(words, scale) {
  const ws = (words || [])
    .filter((w) => w.text && w.text.trim())
    .map((w) => ({
      str: w.text.trim(),
      x: w.bbox.x0 / scale,
      x1: w.bbox.x1 / scale,
      // Ligne de base de la ligne OCR : contrairement au bas du mot, elle ne
      // bouge pas avec les jambages (g, p) — sinon un mot saute à la ligne voisine.
      y: (w.baseline && Number.isFinite(w.baseline.y0)
        ? (w.baseline.y0 + w.baseline.y1) / 2
        : w.bbox.y1) / scale,
      h: Math.max(1, (w.bbox.y1 - w.bbox.y0) / scale),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // Regroupe par ligne visuelle (tolérance d'un demi-corps de lettre).
  const lines = [];
  for (const w of ws) {
    let line = null;
    for (const l of lines) {
      const d = Math.abs(l.y - w.y);
      // Les lignes d'une cellule sur deux lignes sont à ~3,5 pt : tolérance serrée.
      if (d < 1.5 && (!line || d < Math.abs(line.y - w.y))) line = l;
    }
    if (line) { line.words.push(w); line.h = Math.max(line.h, w.h); }
    else lines.push({ y: w.y, h: w.h, words: [w] });
  }

  const items = [];
  for (const l of lines) {
    l.words.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const w of l.words) {
      const gap = cur ? w.x - cur.x1 : Infinity;
      if (cur && gap < Math.max(1.5, l.h * 0.7)) {
        cur.str += ` ${w.str}`;
        cur.x1 = w.x1;
      } else {
        if (cur) items.push(cur);
        cur = { str: w.str, x: w.x, x1: w.x1, y: l.y };
      }
    }
    if (cur) items.push(cur);
  }
  return items.map(({ str, x, x1, y }) => ({ str, x, y, w: x1 - x }));
}
