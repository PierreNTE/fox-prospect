// Côté navigateur uniquement : extraction des items positionnés via unpdf (pdf.js).
import { parseLeadPages } from "@/lib/salesforce-leads";

// Lecture du PDF dans le navigateur : le fichier (~4 Mo) ne transite pas par le
// serveur (limite de corps Vercel ~4,5 Mo) et seules les colonnes utiles partent.
export async function readLeadsPdf(file) {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    pages.push({
      height: vp.height,
      items: tc.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width })),
    });
  }
  return parseLeadPages(pages);
}
