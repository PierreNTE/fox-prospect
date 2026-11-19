// Côté navigateur uniquement : lecture d'un export PDF Salesforce.
//
// 1. Extraction du texte positionné (unpdf / pdf.js) — instantané.
// 2. Si le PDF ne contient pas de texte (imprimé avec « Microsoft Print to PDF »,
//    qui transforme les caractères en dessins), OCR dans le navigateur
//    (tesseract.js, fichiers servis par l'app depuis /ocr : aucun CDN, gratuit).
import { parseLeadPages, ocrWordsToItems } from "@/lib/salesforce-leads";

// 300 dpi : en dessous, les dates (ancres des lignes) sont mal lues.
const OCR_SCALE = 300 / 72;

function wordsOf(data) {
  const out = [];
  for (const b of data?.blocks || [])
    for (const p of b.paragraphs || [])
      for (const l of p.lines || [])
        for (const w of l.words || []) out.push({ text: w.text, bbox: w.bbox, baseline: l.baseline });
  return out;
}

async function ocrPages(pdf, onProgress) {
  const { renderPageAsImage } = await import("unpdf");
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    // La CSP de l'app interdit les workers créés depuis un blob : on charge le
    // script du worker directement depuis /ocr (même origine).
    workerBlobURL: false,
  });
  try {
    // Texte épars : chaque cellule du tableau est lue comme un bloc à part.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.({ phase: "ocr", page: i, pages: pdf.numPages });
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const img = await renderPageAsImage(pdf, i, { scale: OCR_SCALE, toDataURL: true });
      const { data } = await worker.recognize(img, {}, { blocks: true });
      pages.push({ height: vp.height, items: ocrWordsToItems(wordsOf(data), OCR_SCALE) });
    }
    return pages;
  } finally {
    await worker.terminate();
  }
}

export async function readLeadsPdf(file, { onProgress } = {}) {
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
  const parsed = parseLeadPages(pages);
  if (parsed.rows.length || parsed.diagnostic.textItems > 0) return { ...parsed, ocr: false };

  // Aucun caractère dans le PDF : on le lit comme une image.
  const ocr = parseLeadPages(await ocrPages(pdf, onProgress));
  return { ...ocr, ocr: true };
}
