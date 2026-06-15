#!/usr/bin/env node
/**
 * Script de collecte nocturne — Fox Prospect
 *
 * Enchaîne automatiquement :
 *   1. Eval 2 passes — extraction Sonnet (qualité de référence)
 *   2. Pause de 30 s (laisser le temps aux quotas Anthropic de respirer)
 *   3. Eval 2 passes — extraction Haiku (économie ~43%)
 *   4. Affiche un résumé comparatif : Haiku dégrade-t-il la qualité ?
 *
 * Usage :
 *   node --env-file=.env.local scripts/eval-night.mjs
 *   npm run eval:night
 *
 * Les résultats sont sauvegardés dans eval-results/ avec timestamp.
 * Utilise eval-compare.mjs (npm run eval:compare) pour la comparaison détaillée.
 */

import { runEval } from "./eval.mjs";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function bar(pct) {
  const filled = Math.round(pct / 5);
  return "█".repeat(filled) + "░".repeat(20 - filled);
}

async function main() {
  console.log(`\n${BOLD}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  Fox Prospect — Collecte nocturne            ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════╝${RESET}`);
  console.log(`  Démarré le : ${new Date().toLocaleString("fr-FR")}`);
  console.log(`  2 runs prévus : extraction Sonnet puis extraction Haiku\n`);

  // ── Run 1 : 2 passes, extraction Sonnet (référence qualité) ─────────────────
  console.log(`${BOLD}━━━ Run 1/2 : 2 passes — extraction Sonnet ━━━━━${RESET}`);
  const r1 = await runEval({ pass1Only: false, singlePass: false, haikuExtract: false });

  console.log(`\n⏳  Pause 30 secondes avant le run Haiku…`);
  await sleep(30_000);

  // ── Run 2 : 2 passes, extraction Haiku (économie ~43%) ──────────────────────
  console.log(`\n${BOLD}━━━ Run 2/2 : 2 passes — extraction Haiku ━━━━━━${RESET}`);
  const r2 = await runEval({ pass1Only: false, singlePass: false, haikuExtract: true });

  // ── Résumé comparatif ────────────────────────────────────────────────────────
  const s1 = r1.summary, s2 = r2.summary;
  const diffPct = s1.pct - s2.pct;
  const diffCost = s1.cost_eur - s2.cost_eur;
  const diffSearches = s1.searches - s2.searches;

  console.log(`\n${BOLD}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  Résumé comparatif                           ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════╝${RESET}`);
  console.log();
  console.log(`  ${"Extraction".padEnd(22)} ${"Score".padEnd(12)} ${"Coût €".padEnd(10)} Searches`);
  console.log(`  ${"─".repeat(58)}`);

  const fmt1 = `${s1.pct >= 80 ? GREEN : s1.pct >= 60 ? YELLOW : RED}${s1.pct}%${RESET}`;
  const fmt2 = `${s2.pct >= 80 ? GREEN : s2.pct >= 60 ? YELLOW : RED}${s2.pct}%${RESET}`;
  console.log(`  ${"Sonnet (référence)".padEnd(22)} ${(s1.passed + "/" + s1.total).padEnd(8)} ${fmt1.padEnd(20)} ${s1.cost_eur.toFixed(4).padEnd(10)} ${s1.searches}`);
  console.log(`  ${"Haiku (économie)".padEnd(22)} ${(s2.passed + "/" + s2.total).padEnd(8)} ${fmt2.padEnd(20)} ${s2.cost_eur.toFixed(4).padEnd(10)} ${s2.searches}`);
  console.log();

  // Le verdict qui compte : Haiku tient-il la qualité de Sonnet ?
  const haikuDelta = s2.pct - s1.pct; // négatif si Haiku dégrade
  const qualHolds = haikuDelta >= -5; // tolérance 5pp
  console.log(`  ${BOLD}Qualité Haiku${RESET}  : ${qualHolds ? GREEN : RED}${s2.pct}% vs ${s1.pct}% Sonnet (Δ ${haikuDelta >= 0 ? "+" : ""}${haikuDelta}pp)${RESET}`);
  console.log(`  ${BOLD}Verdict${RESET}        : ${qualHolds ? GREEN + "✓ Haiku tient — l'économie est validée" : RED + "✗ Haiku dégrade — garder Sonnet sur l'extraction"}${RESET}`);
  console.log(`  ${BOLD}Note${RESET}           : coûts ci-dessus estimés au tarif Sonnet (les vrais coûts par modèle sont dans /analytics)`);

  console.log();
  console.log(`  Fichiers sauvegardés :`);
  console.log(`    ${CYAN}${r1.outFile}${RESET}`);
  console.log(`    ${CYAN}${r2.outFile}${RESET}`);
  console.log();
  console.log(`  Pour la comparaison détaillée demain :`);
  console.log(`    ${BOLD}npm run eval:compare${RESET}`);
  console.log();
  console.log(`  Terminé le : ${new Date().toLocaleString("fr-FR")}`);
}

main().catch((err) => {
  console.error(`\x1b[31mErreur fatale : ${err.message}\x1b[0m`);
  process.exit(1);
});
