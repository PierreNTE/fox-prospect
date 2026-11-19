// Copie les fichiers de l'OCR (tesseract.js) dans public/ocr pour les servir
// depuis l'app elle-même : pas de dépendance à un CDN, souvent filtré sur un
// réseau d'entreprise. Lancé avant chaque build (npm run prebuild).
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = (pkg) => dirname(require.resolve(`${pkg}/package.json`));
const out = join(process.cwd(), "public", "ocr");
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

copyFileSync(join(root("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js"));
for (const f of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
]) {
  const src = join(root("tesseract.js-core"), f);
  if (existsSync(src)) copyFileSync(src, join(out, "core", f));
}
copyFileSync(
  join(root("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"),
  join(out, "lang", "eng.traineddata.gz")
);
console.log("[ocr] fichiers copiés dans public/ocr");
