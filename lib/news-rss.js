// Actualités d'une société, gratuites et sans clé : flux RSS Google Actualités.
// On ne garde que les articles dont le TITRE cite le nom d'un bloc (évite les
// homonymes), sur les 18 derniers mois.
import { tokens } from "@/lib/company-health";

const FEED = "https://news.google.com/rss/search";

const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const tag = (xml, name) => decode((new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml) || [])[1]);

/** Analyse pure d'un flux RSS Google Actualités. */
export function parseNewsRss(xml, name, { now = Date.now(), months = 18, max = 5 } = {}) {
  const phrase = tokens(name).join(" ");
  if (!phrase) return [];
  const minDate = now - months * 30.5 * 86400_000;
  const items = String(xml || "").split(/<item>/i).slice(1);
  const out = [];
  for (const it of items) {
    const rawTitle = tag(it, "title");
    const source = tag(it, "source") || null;
    // Le titre Google finit par « - Source » : on le retire.
    const titre = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    const d = Date.parse(tag(it, "pubDate"));
    if (!titre || !Number.isFinite(d) || d < minDate) continue;
    if (!` ${tokens(titre).join(" ")} `.includes(` ${phrase} `)) continue;
    out.push({ titre: titre.slice(0, 200), date: new Date(d).toISOString().slice(0, 10), source, url: tag(it, "link") || null });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, max);
}

export async function fetchCompanyNews(name, { fetchImpl = fetch } = {}) {
  const q = String(name || "").replace(/["\\]/g, " ").trim();
  if (tokens(q).join("").length < 4) return []; // nom trop court : trop d'homonymes
  const res = await fetchImpl(`${FEED}?${new URLSearchParams({ q: `"${q}"`, hl: "fr", gl: "FR", ceid: "FR:fr" })}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FoxProspect/1.0)", Accept: "application/rss+xml,application/xml" },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`Google Actualités HTTP ${res.status}`);
  return parseNewsRss(await res.text(), q);
}
