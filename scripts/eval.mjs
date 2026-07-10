#!/usr/bin/env node
/**
 * Harness d'évaluation qualité — Fox Prospect
 *
 * Usage :
 *   node --env-file=.env.local scripts/eval.mjs
 *   node --env-file=.env.local scripts/eval.mjs --pass1-only  (extraction seule, rapide)
 *   node --env-file=.env.local scripts/eval.mjs --single-pass  (mono-passe, compare la baseline)
 *
 * Mesure 6 critères par cas :
 *   ✓ signals_present    — au moins 1 signal trouvé
 *   ✓ score_in_range     — fit_score ∈ [0, 100]
 *   ✓ score_not_zero     — le modèle s'est engagé sur un score non-nul
 *   ✓ hooks_present      — au moins 1 hook d'accroche
 *   ✓ summary_long       — résumé ≥ 80 caractères
 *   ✓ sources_present    — au moins 1 source URL trouvée
 *
 * Le script n'insère rien en base — il appelle l'API Anthropic directement.
 */

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// lib/prompts.js n'a aucun import — importable directement.
// pathToFileURL : sous Windows, un chemin "D:\..." n'est pas une URL ESM valide.
const prompts = await import(pathToFileURL(join(__dirname, "../lib/prompts.js")).href);
const {
  extractionSystemPrompt, extractionUserPrompt,
  judgmentSystemPrompt, judgmentUserPrompt,
  researchSystemPrompt, researchUserPrompt,
} = prompts;

// ── Config ────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("❌  ANTHROPIC_API_KEY manquant. Lance avec --env-file=.env.local");
  process.exit(1);
}

const MODEL = process.env.MODEL_SONNET || "claude-sonnet-4-6";
const MODEL_HAIKU_ID = process.env.MODEL_HAIKU || "claude-haiku-4-5-20251001";
const MAX_SEARCHES = 3; // limité pour garder le coût raisonnable en eval

const args = process.argv.slice(2);
const PASS1_ONLY = args.includes("--pass1-only");
const SINGLE_PASS = args.includes("--single-pass");
const HAIKU_EXTRACT = args.includes("--haiku-extract"); // passe 1 sur Haiku
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? Number(args[i + 1]) || 0 : 0; })();

const API_URL = "https://api.anthropic.com/v1/messages";

// Appel Anthropic via fetch brut (pas de SDK — cohérent avec lib/anthropic.js,
// aucune dépendance npm à installer). Retry léger sur 429/529.
async function anthropicCall({ system, user, model, maxTokens = 2500, webSearch = false, maxSearches = MAX_SEARCHES }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (webSearch) {
    body.tools = [{
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxSearches,
      user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" },
    }];
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let res, detail;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    detail = await res.text();
    if ((res.status !== 429 && res.status !== 529) || attempt === 3) {
      throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
    }
    const ra = Number(res.headers.get("retry-after"));
    await sleep((ra > 0 ? ra : Math.min(20, 10 * attempt)) * 1000);
  }

  const data = await res.json();
  const content = data.content || [];
  const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  // web_search = outil serveur : compte exact dans usage.server_tool_use (pas dans les blocs).
  const searchCount = data.usage?.server_tool_use?.web_search_requests ?? 0;

  let json = null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) json = JSON.parse(m[0]);
  } catch {
    // JSON malformé — signalé en aval par les checks (json_valid: false)
  }
  return { json, usage: data.usage, searchCount, rawText: text };
}

// ── Jeu de cas de référence ───────────────────────────────────────────────────
// 5 prospects fictifs mais plausibles sur le marché IT B2B français.
// Ils représentent des entreprises connues avec des enjeux IT réels — le modèle
// doit donc trouver de vraies informations publiques.

const GOLD_CASES = [
  {
    id: "decathlon-dsi",
    label: "Decathlon — DSI",
    prospect: {
      first_name: "Laurent",
      last_name: "Dupuis",
      role: "DSI",
      company: "Decathlon",
      company_website: "https://www.decathlon.fr",
      linkedin_url: null,
    },
    // Decathlon est en pleine transformation numérique (cloud, IoT RFID, e-commerce)
    // → le modèle devrait trouver des signaux sur leurs projets IT
    expect: { min_signals: 1, min_score: 30, min_hooks: 1 },
  },
  {
    id: "groupama-rssi",
    label: "Groupama — RSSI",
    prospect: {
      first_name: "Isabelle",
      last_name: "Renard",
      role: "RSSI",
      company: "Groupama",
      company_website: "https://www.groupama.fr",
      linkedin_url: null,
    },
    // Secteur assurance : NIS2, DORA, enjeux cyber fort
    // → le modèle devrait identifier des signaux réglementaires
    expect: { min_signals: 1, min_score: 35, min_hooks: 1 },
  },
  {
    id: "sncf-dsi",
    label: "SNCF — Directeur Infrastructure IT",
    prospect: {
      first_name: "Thomas",
      last_name: "Bernard",
      role: "Directeur Infrastructure IT",
      company: "SNCF",
      company_website: "https://www.sncf.com",
      linkedin_url: null,
    },
    // SNCF : grand programme de modernisation IT, OIV (Opérateur d'Importance Vitale)
    // → signaux projet + réglementaires attendus
    expect: { min_signals: 1, min_score: 25, min_hooks: 1 },
  },
  {
    id: "dassault-cto",
    label: "Dassault Systèmes — CTO BU",
    prospect: {
      first_name: "Marie",
      last_name: "Lefevre",
      role: "CTO",
      company: "Dassault Systèmes",
      company_website: "https://www.3ds.com",
      linkedin_url: null,
    },
    // Leader technologique, forte activité cloud et R&D
    // → le modèle devrait trouver actualités récentes
    expect: { min_signals: 1, min_score: 20, min_hooks: 1 },
  },
  {
    id: "orange-rssi",
    label: "Orange — RSSI Groupe",
    prospect: {
      first_name: "Nicolas",
      last_name: "Morin",
      role: "RSSI Groupe",
      company: "Orange",
      company_website: "https://www.orange.com",
      linkedin_url: null,
    },
    // Télécoms : OIV, NIS2, initiatives cybersécurité publiques nombreuses
    // → le modèle devrait facilement trouver des signaux réglementaires + incidents
    expect: { min_signals: 2, min_score: 40, min_hooks: 1 },
  },
];

// ── Appel Anthropic avec web search ──────────────────────────────────────────

async function callWithSearch(system, user, maxSearches = MAX_SEARCHES, model = MODEL) {
  return anthropicCall({ system, user, model, webSearch: true, maxSearches });
}

async function callNoSearch(system, user, model = MODEL) {
  return anthropicCall({ system, user, model, webSearch: false });
}

// ── Vérifications qualité ─────────────────────────────────────────────────────

// expectHooks : true en mono-passe (le prompt historique produit des hooks) ;
// false en 2 passes depuis S2 — les hooks sont générés à la demande dans
// /api/generate, plus dans le jugement. Les noter ici serait une fausse
// régression sur 100 % des cas.
function checkOutput(json, expect, { expectHooks = true } = {}) {
  const checks = {};
  if (!json || typeof json !== "object") {
    const failed = {
      json_valid: false,
      signals_present: false,
      score_in_range: false,
      score_not_zero: false,
      summary_long: false,
      sources_present: false,
    };
    if (expectHooks) failed.hooks_present = false;
    return failed;
  }
  checks.json_valid = true;
  checks.signals_present = Array.isArray(json.signals) && json.signals.length >= (expect?.min_signals ?? 1);
  checks.score_in_range = typeof json.fit_score === "number" && json.fit_score >= 0 && json.fit_score <= 100;
  checks.score_not_zero = typeof json.fit_score === "number" && json.fit_score > 0;
  if (expectHooks) {
    checks.hooks_present = Array.isArray(json.hooks) && json.hooks.length >= (expect?.min_hooks ?? 1);
  }
  checks.summary_long = typeof json.summary === "string" && json.summary.length >= 80;
  checks.sources_present = Array.isArray(json.sources) && json.sources.length > 0;
  return checks;
}

function checkExtraction(json) {
  if (!json || typeof json !== "object") return { json_valid: false, facts_present: false, context_present: false };
  return {
    json_valid: true,
    facts_present: Array.isArray(json.facts),
    context_present: typeof json.company_context === "string" && json.company_context.length > 10,
  };
}

// ── Formattage rapport ────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const tick = (v) => (v ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`);

function printChecks(checks) {
  for (const [k, v] of Object.entries(checks)) {
    const label = k.replace(/_/g, " ").padEnd(18);
    console.log(`      ${tick(v)} ${label}`);
  }
}

function countPasses(checks) {
  return Object.values(checks).filter(Boolean).length;
}

// ── Runner principal (version interne, lit les constantes CLI) ───────────────

async function runCase(cas) {
  const { id, label, prospect, expect } = cas;
  console.log(`\n${BOLD}${CYAN}[${id}]${RESET} ${label}`);

  const t0 = Date.now();
  let totalTokensIn = 0, totalTokensOut = 0, totalSearches = 0;

  if (PASS1_ONLY) {
    // Évalue uniquement l'extraction
    const { json, usage, searchCount } = await callWithSearch(
      extractionSystemPrompt(),
      extractionUserPrompt({ prospect, offer: null }),
    );
    totalTokensIn = usage?.input_tokens ?? 0;
    totalTokensOut = usage?.output_tokens ?? 0;
    totalSearches = searchCount;

    const checks = checkExtraction(json);
    printChecks(checks);
    if (json?.facts) console.log(`      ${CYAN}→ ${json.facts.length} fait(s) extrait(s)${RESET}`);

    const passed = countPasses(checks);
    const total = Object.keys(checks).length;
    console.log(`      Extraction : ${passed}/${total} · ${searchCount} recherches · ${(Date.now() - t0) / 1000}s`);
    return { id, passed, total, tokensIn: totalTokensIn, tokensOut: totalTokensOut, searches: totalSearches };
  }

  if (SINGLE_PASS) {
    // Baseline mono-passe (V2)
    const { json, usage, searchCount } = await callWithSearch(
      researchSystemPrompt(),
      researchUserPrompt({ prospect, offer: null }),
    );
    totalTokensIn = usage?.input_tokens ?? 0;
    totalTokensOut = usage?.output_tokens ?? 0;
    totalSearches = searchCount;

    const checks = checkOutput(json, expect);
    printChecks(checks);
    if (json) console.log(`      ${CYAN}→ score ${json.fit_score} · ${(json.signals || []).length} signal(s) · ${(json.hooks || []).length} hook(s)${RESET}`);

    const passed = countPasses(checks);
    const total = Object.keys(checks).length;
    console.log(`      Mono-passe : ${passed}/${total} · ${searchCount} recherches · ${(Date.now() - t0) / 1000}s`);
    return { id, passed, total, tokensIn: totalTokensIn, tokensOut: totalTokensOut, searches: totalSearches };
  }

  // ── Mode par défaut : 2 passes ────────────────────────────────────────────
  // Passe 1 : extraction
  let extraction = null;
  try {
    const { json: e, usage: u1, searchCount: s1 } = await callWithSearch(
      extractionSystemPrompt(),
      extractionUserPrompt({ prospect, offer: null }),
    );
    totalTokensIn += u1?.input_tokens ?? 0;
    totalTokensOut += u1?.output_tokens ?? 0;
    totalSearches += s1;
    if (e && Array.isArray(e.facts)) extraction = e;
  } catch (err) {
    console.log(`      ${YELLOW}⚠  Passe 1 échouée : ${err.message}${RESET}`);
  }

  if (!extraction) {
    // Fallback mono-passe
    console.log(`      ${YELLOW}→ fallback mono-passe${RESET}`);
    const { json, usage, searchCount } = await callWithSearch(
      researchSystemPrompt(),
      researchUserPrompt({ prospect, offer: null }),
    );
    totalTokensIn += usage?.input_tokens ?? 0;
    totalTokensOut += usage?.output_tokens ?? 0;
    totalSearches += searchCount;
    const checks = checkOutput(json, expect);
    const passed = countPasses(checks);
    const total = Object.keys(checks).length;
    printChecks(checks);
    if (json) console.log(`      ${CYAN}→ score ${json.fit_score} · ${(json.signals || []).length} signal(s)${RESET}`);
    console.log(`      Fallback    : ${passed}/${total} · ${totalSearches} recherches · ${(Date.now() - t0) / 1000}s`);
    return { id, passed, total, tokensIn: totalTokensIn, tokensOut: totalTokensOut, searches: totalSearches };
  }

  console.log(`      ${GREEN}Passe 1 OK${RESET} — ${extraction.facts.length} fait(s) · ${totalSearches} rech.`);

  // Passe 2 : jugement
  const { json, usage: u2, searchCount: s2 } = await callNoSearch(
    judgmentSystemPrompt(),
    judgmentUserPrompt({ prospect, extraction, offer: null }),
  );
  totalTokensIn += u2?.input_tokens ?? 0;
  totalTokensOut += u2?.output_tokens ?? 0;
  totalSearches += s2;

  const checks = checkOutput(json, expect, { expectHooks: false });
  printChecks(checks);
  if (json) console.log(`      ${CYAN}→ score ${json.fit_score} · ${(json.signals || []).length} signal(s) · ${(json.hooks || []).length} hook(s)${RESET}`);

  const passed = countPasses(checks);
  const total = Object.keys(checks).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const costEst = ((totalTokensIn / 1e6) * 3.0 + (totalTokensOut / 1e6) * 15.0 + totalSearches * 0.01).toFixed(4);
  console.log(`      2 passes    : ${passed}/${total} · ${totalSearches} rech. · ${elapsed}s · ~${costEst}€`);
  return { id, label: cas.label, passed, total, checks: {}, tokensIn: totalTokensIn, tokensOut: totalTokensOut, searches: totalSearches };
}

// ── Fonction principale exportable ────────────────────────────────────────────
// Peut être importée par eval-night.mjs pour enchaîner plusieurs modes.

export async function runEval({ pass1Only = false, singlePass = false, haikuExtract = false, silent = false } = {}) {
  const mode = pass1Only ? "pass1-only" : singlePass ? "single-pass" : haikuExtract ? "2-pass-haiku" : "2-pass";
  const modeLabel = pass1Only ? "extraction seule" : singlePass ? "mono-passe (baseline)" : haikuExtract ? "2 passes (extraction Haiku)" : "2 passes (V3, extraction Sonnet)";

  if (!silent) {
    console.log(`\n${BOLD}Fox Prospect — Eval harness${RESET}`);
    console.log(`Modèle : ${MODEL} · Mode : ${modeLabel} · ${GOLD_CASES.length} cas\n`);
  }

  const caseResults = [];
  let totalTokensIn = 0, totalTokensOut = 0, totalSearches = 0;

  // --limit N : réduit le nombre de cas (smoke test peu coûteux).
  const cases = LIMIT > 0 ? GOLD_CASES.slice(0, LIMIT) : GOLD_CASES;
  for (const cas of cases) {
    try {
      // Surcharge temporaire des flags globaux pour l'appel à runCase
      const r = await _runCase(cas, pass1Only, singlePass, haikuExtract);
      caseResults.push(r);
      totalTokensIn += r.tokensIn || 0;
      totalTokensOut += r.tokensOut || 0;
      totalSearches += r.searches || 0;
    } catch (err) {
      if (!silent) console.error(`${RED}Erreur sur ${cas.id}: ${err.message}${RESET}`);
      caseResults.push({ id: cas.id, label: cas.label, passed: 0, total: 7, error: err.message });
    }
  }

  const totalPassed = caseResults.reduce((s, r) => s + r.passed, 0);
  const totalChecks = caseResults.reduce((s, r) => s + r.total, 0);
  const pct = Math.round((totalPassed / totalChecks) * 100);
  const costEur = +((totalTokensIn / 1e6) * 3.0 + (totalTokensOut / 1e6) * 15.0 + totalSearches * 0.01).toFixed(4);

  const output = {
    mode,
    model: MODEL,
    ran_at: new Date().toISOString(),
    cases: caseResults,
    summary: { passed: totalPassed, total: totalChecks, pct, tokens_in: totalTokensIn, tokens_out: totalTokensOut, searches: totalSearches, cost_eur: costEur },
  };

  // Sauvegarde automatique dans eval-results/
  const outDir = join(__dirname, "../eval-results");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const outFile = join(outDir, `${ts}-${mode}.json`);
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  if (!silent) console.log(`\n${CYAN}Résultats sauvegardés → ${outFile}${RESET}`);

  if (!silent) {
    const costStr = costEur.toFixed(3);
    console.log(`\n${"─".repeat(52)}`);
    console.log(`${BOLD}Résultats${RESET}   ${pct >= 80 ? GREEN : pct >= 60 ? YELLOW : RED}${totalPassed}/${totalChecks} (${pct}%)${RESET}`);
    console.log(`Tokens       ${(totalTokensIn / 1000).toFixed(1)}k in · ${(totalTokensOut / 1000).toFixed(1)}k out`);
    console.log(`Web searches ${totalSearches}`);
    console.log(`Coût estimé  ~${costStr} €`);
    for (const r of caseResults) {
      const ok = r.passed === r.total;
      console.log(`  ${tick(ok)} ${r.id.padEnd(20)} ${r.passed}/${r.total}`);
    }
    console.log(`${"─".repeat(52)}\n`);
  }

  return { ...output, outFile };
}

// runCase avec flags passés explicitement (pour l'export)
async function _runCase(cas, pass1Only, singlePass, haikuExtract = false) {
  const { id, label, prospect, expect } = cas;
  console.log(`\n${BOLD}${CYAN}[${id}]${RESET} ${label}`);
  const t0 = Date.now();
  let totalTokensIn = 0, totalTokensOut = 0, totalSearches = 0;

  if (pass1Only) {
    const { json, usage, searchCount } = await callWithSearch(extractionSystemPrompt(), extractionUserPrompt({ prospect, offer: null }));
    totalTokensIn = usage?.input_tokens ?? 0; totalTokensOut = usage?.output_tokens ?? 0; totalSearches = searchCount;
    const checks = checkExtraction(json);
    printChecks(checks);
    if (json?.facts) console.log(`      ${CYAN}→ ${json.facts.length} fait(s) extrait(s)${RESET}`);
    const passed = countPasses(checks);
    const total = Object.keys(checks).length;
    console.log(`      Extraction : ${passed}/${total} · ${searchCount} recherches · ${(Date.now() - t0) / 1000}s`);
    return { id, label, passed, total, checks, tokensIn: totalTokensIn, tokensOut: totalTokensOut, searches: totalSearches };
  }

  if (singlePass) {
    const { json, usage, searchCount } = await callWithSearch(researchSystemPrompt(), researchUserPrompt({ prospect, offer: null }));
    totalTokensIn = usage?.input_tokens ?? 0; totalTokensOut = usage?.output_tokens ?? 0; totalSearches = searchCount;
    const checks = checkOutput(json, expect);
    printChecks(checks);
    if (json) console.log(`      ${CYAN}→ score ${json.fit_score} · ${(json.signals || []).length} signal(s) · ${(json.hooks || []).length} hook(s)${RESET}`);
    const passed = countPasses(checks);
    const total = Object.keys(checks).length;
    console.log(`      Mono-passe : ${passed}/${total} · ${searchCount} recherches · ${(Date.now() - t0) / 1000}s`);
    return { id, label, passed, total, checks, fit_score: json?.fit_score, signals_count: (json?.signals || []).length, hooks_count: (json?.hooks || []).length, tokensIn: totalTokensIn, tokensOut: totalTokensOut, searches: totalSearches };
  }

  // 2 passes — extraction sur Haiku si haikuExtract, sinon Sonnet
  const extractModel = haikuExtract ? MODEL_HAIKU_ID : MODEL;
  let extraction = null;
  try {
    const { json: e, usage: u1, searchCount: s1 } = await callWithSearch(extractionSystemPrompt(), extractionUserPrompt({ prospect, offer: null }), MAX_SEARCHES, extractModel);
    totalTokensIn += u1?.input_tokens ?? 0; totalTokensOut += u1?.output_tokens ?? 0; totalSearches += s1;
    if (e && Array.isArray(e.facts)) extraction = e;
  } catch (err) {
    console.log(`      ${YELLOW}⚠  Passe 1 échouée : ${err.message}${RESET}`);
  }

  let json, extraChecks = {};
  if (!extraction) {
    console.log(`      ${YELLOW}→ fallback mono-passe${RESET}`);
    const r = await callWithSearch(researchSystemPrompt(), researchUserPrompt({ prospect, offer: null }));
    json = r.json; totalTokensIn += r.usage?.input_tokens ?? 0; totalTokensOut += r.usage?.output_tokens ?? 0; totalSearches += r.searchCount;
  } else {
    console.log(`      ${GREEN}Passe 1 OK${RESET} — ${extraction.facts.length} fait(s) · ${totalSearches} rech.`);
    const r = await callNoSearch(judgmentSystemPrompt(), judgmentUserPrompt({ prospect, extraction, offer: null }));
    json = r.json; totalTokensIn += r.usage?.input_tokens ?? 0; totalTokensOut += r.usage?.output_tokens ?? 0; totalSearches += r.searchCount;
    extraChecks.facts_count = extraction.facts.length;
  }

  // Hooks attendus seulement si on est retombé en mono-passe (prompt historique).
  const checks = checkOutput(json, expect, { expectHooks: !extraction });
  printChecks(checks);
  if (json) console.log(`      ${CYAN}→ score ${json.fit_score} · ${(json.signals || []).length} signal(s) · ${(json.hooks || []).length} hook(s)${RESET}`);
  const passed = countPasses(checks);
  const total = Object.keys(checks).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const costEst = ((totalTokensIn / 1e6) * 3.0 + (totalTokensOut / 1e6) * 15.0 + totalSearches * 0.01).toFixed(4);
  console.log(`      2 passes    : ${passed}/${total} · ${totalSearches} rech. · ${elapsed}s · ~${costEst}€`);
  return { id, label, passed, total, checks, fit_score: json?.fit_score, signals_count: (json?.signals || []).length, hooks_count: (json?.hooks || []).length, ...extraChecks, tokensIn: totalTokensIn, tokensOut: totalTokensOut, searches: totalSearches };
}

async function main() {
  await runEval({ pass1Only: PASS1_ONLY, singlePass: SINGLE_PASS, haikuExtract: HAIKU_EXTRACT });
  process.exit(0);
}

// Dual-use : importable comme module OU exécutable directement.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`${RED}Erreur fatale : ${err.message}${RESET}`);
    process.exit(1);
  });
}
