// Marchés publics informatiques d'un acheteur public (BOAMP, gratuit, sans clé).
// Utile pour les collectivités, hôpitaux et établissements publics de la liste :
// avis de marché en cours (date limite de réponse) et attributions passées
// (titulaire en place, date → fenêtre de renouvellement).
import { tokens } from "@/lib/company-health";
import { recordText } from "@/lib/company-successor";

const BOAMP_URL = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

export const IT_TERMS = /informatique|serveur|stockage|sauvegarde|baie|datacenter|data ?center|virtualisation|infrastructure|r[ée]seau|postes? de travail|ordinateur|mat[ée]riel informatique|logiciel|cybers[ée]curit[ée]|h[ée]bergement|cloud|infog[ée]rance|maintenance (du|des) (syst[èe]me|parc|mat[ée]riel)/i;

/** L'organisation est-elle un acheteur public (NAF 84, catégorie juridique 7xxx, hôpital public) ? */
export function isPublicBuyer(detail = {}) {
  const naf = String(detail.naf || "").replace(/[^0-9]/g, "");
  const nj = String(detail.nature_juridique || "");
  return naf.startsWith("84") || nj.startsWith("7") || (naf.startsWith("861") && nj.startsWith("7"));
}

const pick = (r, keys) => {
  for (const k of keys) {
    const v = r[k];
    if (v != null && v !== "") return Array.isArray(v) ? v.join(", ") : String(v);
  }
  return "";
};

/** Normalise et filtre les annonces : bon acheteur + objet informatique. */
export function normalizeNotices(records, buyerName) {
  const phrase = tokens(buyerName).join(" ");
  return (records || [])
    .map((r) => {
      const buyer = pick(r, ["nomacheteur", "acheteur", "nom_acheteur"]);
      const objet = pick(r, ["objet", "intitule", "titre", "title"]);
      return {
        id: pick(r, ["idweb", "id", "numero"]),
        objet: objet.slice(0, 300),
        acheteur: buyer,
        nature: pick(r, ["nature_libelle", "nature", "type_avis", "typeavis"]),
        date: pick(r, ["dateparution", "date_publication"]).slice(0, 10),
        limite: pick(r, ["datelimitereponse", "date_limite_reponse"]).slice(0, 10),
        titulaire: pick(r, ["titulaire", "nomtitulaire", "attributaire"]).slice(0, 200),
        url: pick(r, ["url_avis", "url"]),
        _text: recordText(r),
      };
    })
    .filter((n) => {
      const who = ` ${tokens(n.acheteur || n._text).join(" ")} `;
      return phrase && who.includes(` ${phrase} `) && IT_TERMS.test(`${n.objet} ${n._text.slice(0, 2000)}`);
    })
    .map(({ _text, ...n }) => ({
      ...n,
      url: n.url || (n.id ? `https://www.boamp.fr/pages/avis/?q=idweb:%22${encodeURIComponent(n.id)}%22` : ""),
      ouvert: !!n.limite && n.limite >= new Date().toISOString().slice(0, 10),
    }))
    .slice(0, 8);
}

export async function fetchItNotices(buyerName, { fetchImpl = fetch } = {}) {
  const q = String(buyerName || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 4) return [];
  const get = (where, orderBy = "dateparution desc") => fetchImpl(`${BOAMP_URL}?${new URLSearchParams({
    where, limit: "50", ...(orderBy ? { order_by: orderBy } : {}),
  })}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });

  let res = await get(`"${q}" AND ("informatique" OR "serveurs" OR "stockage" OR "sauvegarde" OR "infrastructure" OR "réseau" OR "matériel informatique")`);
  // Requête refusée (syntaxe ou champ de tri) : repli sur le seul nom, filtré ici.
  if (res.status === 400) res = await get(`"${q}"`, null);
  if (!res.ok) throw new Error(`BOAMP HTTP ${res.status}`);
  const data = await res.json();
  return normalizeNotices(data?.results || [], q)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
