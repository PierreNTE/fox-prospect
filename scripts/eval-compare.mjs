#!/usr/bin/env node
/**
 * Comparaison des résultats d'évaluation — Fox Prospect
 *
 * Usage :
 *   npm run eval:compare                          ← compare les 2 derniers fichiers
 *   node scripts/eval-compare.mjs file1 file2     ← compare deux fichiers explicites
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "../eval-results");

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function color(pct) {
  return pct >= 80 ? GREEN : pct >= 60 ? YELLOW : RED;
}

function delta(a, b, higherIsBetter = true) {
  const d = a - b;
  if (d === 0) return `${YELLOW}=`;
  const sign = d > 0 ? "+" : "";
  return d > 0 === higherIsBetter ? `${GREEN}${sign}${d}` : `${RED}${sign}${d}`;
}

function deltaF(a, b, higherIsBetter = true, decimals = 4) {
  const d = +(a - b).toFixed(decimals);
  if (d === 0) return `${YELLOW}=`;
  const sign = d > 0 ? "+" : "";
  return d > 0 === higherIsBetter ? `${GREEN}${sign}${d}` : `${RED}${sign}${d}`;
}

// ── Lecture des fichiers ──────────────────────────────────────────────────────

let files = process.argv.slice(2);

if (files.length === 0) {
  // Auto-détecte les 2 fichiers les plus récents dans eval-results/
  let entries;
  try {
    entries = readdirSync(RESULTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 2)
      .reverse(); // du plus ancien au plus récent
  } catch {
    console.error(`${RED}Dossier eval-results/ introuvable. Lance d'abord : npm run eval:night${RESET}`);
    process.exit(1);
  }
  if (entries.length < 2) {
    console.error(`${RED}Moins de 2 fichiers dans eval-results/ — lance d'abord : npm run eval:night${RESET}`);
    process.exit(1);
  }
  files = entries.map((f) => join(RESULTS_DIR, f));
  console.log(`${CYAN}Auto-détection : comparaison des 2 derniers fichiers${RESET}`);
  console.log(`  A : ${files[0]}`);
  console.log(`  B : ${files[1]}\n`);
}

if (files.length !== 2) {
  console.error("Usage : node scripts/eval-compare.mjs [fileA] [fileB]");
  process.exit(1);
}

let dataA, dataB;
try {
  dataA = JSON.parse(readFileSync(files[0], "utf-8"));
  dataB = JSON.parse(readFileSync(files[1], "utf-8"));
} catch (err) {
  console.error(`${RED}Erreur de lecture : ${err.message}${RESET}`);
  process.exit(1);
}

// ── Affichage ─────────────────────────────────────────────────────────────────

const sA = dataA.summary, sB = dataB.summary;
const labelA = `${dataA.mode} (A)`;
const labelB = `${dataB.mode} (B)`;

console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}║  Fox Prospect — Comparaison eval                         ║${RESET}`);
console.log(`${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
console.log();
console.log(`  A : ${CYAN}${dataA.mode}${RESET} — ${dataA.ran_at}`);
console.log(`  B : ${CYAN}${dataB.mode}${RESET} — ${dataB.ran_at}`);

// ── Résumé global ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Résumé global${RESET}`);
console.log(`${"─".repeat(58)}`);
console.log(
  `${"Métrique".padEnd(22)} ${"A".padEnd(14)} ${"B".padEnd(14)} Delta`
);
console.log(`${"─".repeat(58)}`);

const rows = [
  ["Score qualité", `${color(sA.pct)}${sA.pct}%${RESET} (${sA.passed}/${sA.total})`, `${color(sB.pct)}${sB.pct}%${RESET} (${sB.passed}/${sB.total})`, `${delta(sA.pct, sB.pct)}pp${RESET}`],
  ["Coût estimé €", sA.cost_eur.toFixed(4), sB.cost_eur.toFixed(4), `${deltaF(sA.cost_eur, sB.cost_eur, false)}${RESET}`],
  ["Tokens in (k)", (sA.tokens_in / 1000).toFixed(1), (sB.tokens_in / 1000).toFixed(1), `${deltaF(sA.tokens_in / 1000, sB.tokens_in / 1000, false, 1)}${RESET}`],
  ["Tokens out (k)", (sA.tokens_out / 1000).toFixed(1), (sB.tokens_out / 1000).toFixed(1), `${deltaF(sA.tokens_out / 1000, sB.tokens_out / 1000, false, 1)}${RESET}`],
  ["Web searches", sA.searches, sB.searches, `${delta(sA.searches, sB.searches, false)}${RESET}`],
];

for (const [label, a, b, d] of rows) {
  console.log(`${label.padEnd(22)} ${String(a).padEnd(14)} ${String(b).padEnd(14)} ${d}`);
}

// ── Détail par cas ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Détail par cas${RESET}`);
console.log(`${"─".repeat(70)}`);
console.log(`${"Cas".padEnd(24)} ${"A score".padEnd(10)} ${"B score".padEnd(10)} ${"Δ".padEnd(6)} ${"A fit".padEnd(8)} ${"B fit"}`);
console.log(`${"─".repeat(70)}`);

const casMap = {};
for (const c of dataA.cases || []) casMap[c.id] = { a: c };
for (const c of dataB.cases || []) {
  if (!casMap[c.id]) casMap[c.id] = {};
  casMap[c.id].b = c;
}

for (const [id, { a, b }] of Object.entries(casMap)) {
  const aScore = a ? `${a.passed}/${a.total}` : "—";
  const bScore = b ? `${b.passed}/${b.total}` : "—";
  const d = a && b ? a.passed - b.passed : null;
  const dStr = d === null ? "—" : d === 0 ? `${YELLOW}=` : d > 0 ? `${GREEN}+${d}` : `${RED}${d}`;
  const aFit = a?.fit_score != null ? a.fit_score : "—";
  const bFit = b?.fit_score != null ? b.fit_score : "—";
  const label = a?.label || b?.label || id;
  console.log(`${label.slice(0, 23).padEnd(24)} ${aScore.padEnd(10)} ${bScore.padEnd(10)} ${(dStr + RESET).padEnd(15)} ${String(aFit).padEnd(8)} ${bFit}`);
}

// ── Critères : taux de réussite par check ─────────────────────────────────────
const allChecks = new Set();
for (const c of [...(dataA.cases || []), ...(dataB.cases || [])]) {
  for (const k of Object.keys(c.checks || {})) allChecks.add(k);
}

if (allChecks.size > 0) {
  console.log(`\n${BOLD}Taux de réussite par critère${RESET}`);
  console.log(`${"─".repeat(58)}`);
  console.log(`${"Critère".padEnd(22)} ${"A".padEnd(12)} ${"B".padEnd(12)} Delta`);
  console.log(`${"─".repeat(58)}`);

  for (const check of allChecks) {
    const passA = (dataA.cases || []).filter((c) => c.checks?.[check]).length;
    const passB = (dataB.cases || []).filter((c) => c.checks?.[check]).length;
    const nA = (dataA.cases || []).filter((c) => c.checks != null && check in c.checks).length;
    const nB = (dataB.cases || []).filter((c) => c.checks != null && check in c.checks).length;
    const pctA = nA ? Math.round((passA / nA) * 100) : null;
    const pctB = nB ? Math.round((passB / nB) * 100) : null;
    const d = pctA != null && pctB != null ? pctA - pctB : null;
    const dStr = d === null ? "—" : d === 0 ? `${YELLOW}=` : d > 0 ? `${GREEN}+${d}pp` : `${RED}${d}pp`;
    const aStr = pctA != null ? `${color(pctA)}${passA}/${nA} (${pctA}%)${RESET}` : "—";
    const bStr = pctB != null ? `${color(pctB)}${passB}/${nB} (${pctB}%)${RESET}` : "—";
    console.log(`${check.replace(/_/g, " ").padEnd(22)} ${aStr.padEnd(22)} ${bStr.padEnd(22)} ${dStr}${RESET}`);
  }
}

// ── Conclusion ────────────────────────────────────────────────────────────────
const diffPct = sA.pct - sB.pct;
const diffCost = sA.cost_eur - sB.cost_eur;
console.log(`\n${BOLD}Conclusion${RESET}`);
if (diffPct > 0) {
  console.log(`  ${GREEN}A (${dataA.mode}) est meilleur${RESET} de ${diffPct}pp en qualité`);
  if (diffCost > 0) console.log(`  Mais coûte ${diffCost.toFixed(4)} € de plus par run (${Math.round((diffCost / Math.max(sB.cost_eur, 0.0001)) * 100)}%)`);
} else if (diffPct < 0) {
  console.log(`  ${GREEN}B (${dataB.mode}) est meilleur${RESET} de ${Math.abs(diffPct)}pp en qualité`);
} else {
  console.log(`  ${YELLOW}Qualité identique${RESET} — regarder le coût et les détails par cas`);
}
console.log();
