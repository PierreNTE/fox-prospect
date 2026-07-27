import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { MODEL_HAIKU } from "@/lib/constants";
import { monthlySpendEur, monthlyBudgetEur } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/health — diagnostic des dépendances qui conditionnent la prod.
// Protégé par le middleware (login requis). Vérifie en parallèle :
//  - Supabase (requête réelle)
//  - Anthropic (micro-appel Haiku max_tokens:1 → détecte les crédits à zéro)
//  - Brave Search (micro-requête → détecte une clé invalide ; coût quota ~0)
//  - présence des secrets optionnels (scraping, France Travail)
//  - budget mensuel consommé vs plafond
// Le micro-appel Anthropic coûte une fraction de centime et n'est PAS loggé
// dans ai_runs (ce n'est pas une vraie qualif).

const ok = (detail, extra = {}) => ({ status: "ok", detail, ...extra });
const ko = (detail, extra = {}) => ({ status: "error", detail, ...extra });
const absent = (detail) => ({ status: "absent", detail });

async function checkSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return ko("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants.");
  }
  try {
    const supabase = getSupabase();
    const { error, count } = await supabase
      .from("settings")
      .select("*", { count: "exact", head: true });
    if (error) return ko(error.message);
    return ok(`connecté (table settings: ${count ?? 0} ligne).`);
  } catch (e) {
    return ko(e.message);
  }
}

async function checkAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return ko("ANTHROPIC_API_KEY manquante.");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL_HAIKU,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (res.ok) return ok("clé valide et crédits disponibles.");
    const text = (await res.text()).slice(0, 300);
    // Anthropic renvoie 400 "credit balance is too low" quand les crédits sont épuisés.
    if (/credit balance/i.test(text)) {
      return ko("crédits Anthropic épuisés — recharger sur console.anthropic.com.", { critical: true });
    }
    if (res.status === 401) return ko("clé Anthropic invalide (401).");
    return ko(`Anthropic ${res.status}: ${text}`);
  } catch (e) {
    return ko(e.message);
  }
}

async function checkBrave() {
  if (!process.env.BRAVE_API_KEY) {
    return absent("BRAVE_API_KEY non posée — découverte en repli DDG (fragile).");
  }
  try {
    const res = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
      headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY, accept: "application/json" },
    });
    if (res.ok) return ok("clé Brave valide.");
    if (res.status === 401 || res.status === 403) return ko("clé Brave invalide ou plan insuffisant.");
    if (res.status === 429) return ok("clé valide mais quota mensuel atteint (2000/mois).");
    return ko(`Brave ${res.status}.`);
  } catch (e) {
    return ko(e.message);
  }
}

function checkConfig() {
  const present = (v) => (process.env[v] ? "ok" : "absent");
  return {
    dispatch_immédiat: {
      GITHUB_DISPATCH_TOKEN: present("GITHUB_DISPATCH_TOKEN"),
      GITHUB_REPO: present("GITHUB_REPO"),
      detail: process.env.GITHUB_DISPATCH_TOKEN && process.env.GITHUB_REPO
        ? "scraping déclenché en quasi-instantané."
        : "sans ça, le cron GitHub (toutes les 6 h) prend le relais.",
    },
    scrape_proxy: process.env.SCRAPE_PROXY
      ? "ok (quasi inutile depuis Brave)."
      : "absent (OK : découverte via Brave, pas besoin de proxy).",
    france_travail: process.env.FRANCE_TRAVAIL_CLIENT_ID && process.env.FRANCE_TRAVAIL_CLIENT_SECRET
      ? "ok (signaux emploi actifs)."
      : "absent (pas de signaux offres d'emploi).",
    cron_secret: process.env.CRON_SECRET ? "ok (crons protégés)." : "absent (crons non protégés).",
    app_password: process.env.APP_PASSWORD ? "ok." : "absent (app non protégée !).",
  };
}

// File de jobs (jobs) : des jobs restés en échec = un blocage silencieux
// (crédits/plafond Anthropic, cron cassé…) qui, sinon, ne se voit nulle part.
async function checkJobs() {
  try {
    const supabase = getSupabase();
    const [{ count: errCount }, { count: pendCount }] = await Promise.all([
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("status", "error"),
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const errors = errCount ?? 0;
    const pending = pendCount ?? 0;
    if (errors > 0) {
      return ko(`${errors} job(s) en échec, ${pending} en attente — vérifie les crédits Anthropic ou le cron.`, { errors, pending });
    }
    return ok(`file saine : ${pending} en attente, 0 échec.`, { errors, pending });
  } catch (e) {
    return ko(e.message, { errors: 0, pending: 0 });
  }
}

// Âge du dernier passage de veille — le détecteur du signal de vie.
//
// GitHub désactive les crons après 60 jours sans activité sur le dépôt, et un
// cron désactivé ne lève rien : il se tait. Le seul moyen de le voir est de
// mesurer un SILENCE, depuis un hébergeur différent. Vercel lit ici la date du
// dernier `pipeline_runs`, alimenté à la fois par le pipeline lui-même et par
// /api/cron/veille-heartbeat.
//
// 48 h et non 24 : le passage est quotidien, une exécution manquée (incident
// runner, dépôt en maintenance) ne doit pas crier au loup.
const VEILLE_SILENCE_MAX_H = 48;

async function checkVeille() {
  try {
    const { data, error } = await getSupabase()
      .from("pipeline_runs")
      .select("finished_at, stage")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1);

    if (error) return ko(`pipeline_runs illisible : ${error.message}`, { stale: null });
    if (!data?.length) return ko("aucun passage de veille enregistré.", { stale: true, hours: null });

    const heures = (Date.now() - new Date(data[0].finished_at).getTime()) / 3_600_000;
    const arrondi = Math.round(heures * 10) / 10;
    if (heures > VEILLE_SILENCE_MAX_H) {
      return ko(
        `aucun passage depuis ${Math.round(heures)} h — cron GitHub désactivé ou en panne.`,
        { stale: true, hours: arrondi }
      );
    }
    return ok(`dernier passage il y a ${arrondi} h.`, { stale: false, hours: arrondi });
  } catch (e) {
    return ko(e.message, { stale: null });
  }
}

export async function GET() {
  const [supabase, anthropic, brave, jobs, veille] = await Promise.all([
    checkSupabase(),
    checkAnthropic(),
    checkBrave(),
    checkJobs(),
    checkVeille(),
  ]);

  const budget = monthlyBudgetEur();
  let spent = null;
  try {
    spent = await monthlySpendEur();
  } catch {
    spent = null;
  }

  // Statut global : rouge si une brique critique (Supabase, Anthropic) est KO.
  const critical = [supabase, anthropic];
  const healthy = critical.every((c) => c.status === "ok");

  return NextResponse.json({
    healthy,
    checked_at: new Date().toISOString(),
    services: { supabase, anthropic, brave, jobs, veille },
    budget: {
      month_spent_eur: spent == null ? null : Math.round(spent * 100) / 100,
      month_budget_eur: budget,
      remaining_eur: spent == null ? null : Math.max(0, Math.round((budget - spent) * 100) / 100),
    },
    config: checkConfig(),
  });
}
