// QW4 — validateurs légers pour toutes les sorties LLM.
// Sans dépendance externe : coerce les valeurs dans les types et enums attendus
// plutôt que de rejeter — une réponse partiellement correcte vaut mieux qu'une 500.

import {
  SIGNAL_TYPES, RELIABILITY, ROLE_CONFIDENCE, EMAIL_CONFIDENCE, LINKEDIN_CONFIDENCE,
  NEWS_CATEGORIES, ORG_LEVELS,
} from "@/lib/constants";

// ── JSON Schemas (sorties structurées, output_config.format) ────────────────
// Contraintes du format : additionalProperties:false + required exhaustif sur
// chaque objet, pas de bornes numériques (le clamp reste dans les validateurs).

const FACT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: { type: "string", enum: [...SIGNAL_TYPES] },
    detail: { type: "string", description: "Fait précis et daté" },
    date: { type: "string", description: "YYYY-MM ou YYYY-MM-DD" },
    source_url: { type: "string", description: "URL complète de la source" },
  },
  required: ["type", "detail", "date", "source_url"],
  additionalProperties: false,
});

export const EXTRACTION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    facts: { type: "array", items: FACT_SCHEMA },
    company_context: { type: "string", description: "Contexte entreprise en 2-3 phrases, ou ce qui a été cherché si facts est vide" },
    contact_context: { type: "string", description: "Ce qu'on sait publiquement du contact, ou chaîne vide" },
  },
  required: ["facts", "company_context", "contact_context"],
  additionalProperties: false,
});

export const JUDGMENT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary: { type: "string" },
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...SIGNAL_TYPES] },
          detail: { type: "string" },
          date: { type: "string" },
          source: { type: "string" },
        },
        required: ["type", "detail", "date", "source"],
        additionalProperties: false,
      },
    },
    fit_score: { type: "integer" },
    fit_reason: { type: "string" },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "signals", "fit_score", "fit_reason", "sources"],
  additionalProperties: false,
});

export const GENERATE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    email_subject: { type: "string" },
    email_body: { type: "string" },
    linkedin_message: { type: "string" },
    call_points: { type: "array", items: { type: "string" } },
  },
  required: ["email_subject", "email_body", "linkedin_message", "call_points"],
  additionalProperties: false,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const str = (v, d = "") => (typeof v === "string" ? v.trim() : d);
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const oneOf = (v, allowed, d) => (allowed.includes(v) ? v : d);

// ── Schémas ───────────────────────────────────────────────────────────────────

export function validateResearch(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Réponse LLM non-objet.");
  const signals = arr(raw.signals).map((s) => ({
    type: oneOf(s?.type, SIGNAL_TYPES, "autre"),
    detail: str(s?.detail, "—"),
    date: str(s?.date),
    source: str(s?.source),
  }));
  const hooks = arr(raw.hooks).slice(0, 3).map((h) => ({
    angle: str(h?.angle),
    pourquoi: str(h?.pourquoi),
    phrase: str(h?.phrase),
  }));
  return {
    summary: str(raw.summary),
    signals,
    fit_score: clamp(Math.round(num(raw.fit_score, 0)), 0, 100),
    fit_reason: str(raw.fit_reason),
    hooks,
    sources: arr(raw.sources).filter((u) => typeof u === "string" && u.startsWith("http")),
  };
}

export function validateGenerate(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Réponse LLM non-objet.");
  return {
    email_subject: str(raw.email_subject),
    email_body: str(raw.email_body),
    linkedin_message: str(raw.linkedin_message).slice(0, 300),
    call_points: arr(raw.call_points).slice(0, 5).map((p) => str(p)),
  };
}

export function validateAccount(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Réponse LLM non-objet.");
  // News : catégorie contrainte à la liste « impact métier/IT », triées
  // récent → ancien. Défaut "autre" et NON "projet" : rabattre une catégorie
  // inconnue sur "projet" lui accordait un impact fort (26) qu'elle n'a pas
  // méritée, et gonflait artificiellement la chaleur du compte.
  const news = arr(raw.news)
    .map((n) => ({
      title: str(n?.title),
      detail: str(n?.detail),
      date: str(n?.date),
      source: str(n?.source),
      url: str(n?.url),
      category: oneOf(n?.category, NEWS_CATEGORIES, "autre"),
    }))
    .filter((n) => n.title || n.detail)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 8);
  const signals = arr(raw.signals).map((s) => ({
    type: oneOf(s?.type, SIGNAL_TYPES, "autre"),
    detail: str(s?.detail, "—"),
    date: str(s?.date),
    source: str(s?.source),
    weight: num(s?.weight, 0),
  }));
  const org = arr(raw.org).map((p) => ({
    first_name: str(p?.first_name),
    last_name: str(p?.last_name),
    role: str(p?.role),
    department: str(p?.department),
    level: oneOf(p?.level, ORG_LEVELS, ""),
    responsibilities: str(p?.responsibilities),
    email: str(p?.email),
    phone: str(p?.phone),
    linkedin_url: str(p?.linkedin_url),
    reliability: oneOf(p?.reliability, RELIABILITY, "non_verifie"),
    role_confidence: oneOf(p?.role_confidence, ROLE_CONFIDENCE, "incertain"),
    data_date: str(p?.data_date),
    source: str(p?.source),
    manager_name: str(p?.manager_name),
  }));
  return {
    sector: str(raw.sector),
    hq: str(raw.hq),
    website: str(raw.website),
    domain: str(raw.domain),
    summary: str(raw.summary),
    news,
    signals,
    sources: arr(raw.sources).filter((u) => typeof u === "string" && u.startsWith("http")),
    org,
  };
}

export function validateEnrich(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Réponse LLM non-objet.");
  return {
    email: str(raw.email),
    phone: str(raw.phone),
    email_confidence: oneOf(raw.email_confidence, EMAIL_CONFIDENCE, "basse"),
    email_source: str(raw.email_source),
  };
}

export function validateBrief(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Réponse LLM non-objet.");

  const CHANGE_TYPES = ["poste", "equipe", "organisation", "recrutement", "projet", "actualite"];
  const CANALS = ["appel", "email", "linkedin"];
  const RELATIONS = ["manager", "n-1", "pair"];
  const DISC_PROFILES = ["D", "I", "S", "C", "DI", "DC", "ID", "IS", "SC", "CD"];
  const CONFIANCE = ["haute", "moyenne", "basse"];

  const changements_recents = arr(raw.changements_recents).slice(0, 6).map((c) => ({
    type: oneOf(c?.type, CHANGE_TYPES, "actualite"),
    detail: str(c?.detail, "—"),
    date: str(c?.date),
    source: str(c?.source),
    accroche: str(c?.accroche),
  }));

  const accroches = arr(raw.accroches).slice(0, 4).map((a) => ({
    angle: str(a?.angle),
    phrase: str(a?.phrase),
    canal: oneOf(a?.canal, CANALS, "email"),
  }));

  const d = raw.disc && typeof raw.disc === "object" ? raw.disc : null;
  const profilUpper = d ? str(d.profil).toUpperCase() : "";
  const disc = d ? {
    profil: DISC_PROFILES.includes(profilUpper) ? profilUpper : null,
    traits: arr(d.traits).map((t) => str(t)).filter(Boolean).slice(0, 6),
    style_communication: str(d.style_communication),
    a_faire: arr(d.a_faire).map((t) => str(t)).filter(Boolean).slice(0, 5),
    a_eviter: arr(d.a_eviter).map((t) => str(t)).filter(Boolean).slice(0, 5),
    confiance: oneOf(d.confiance, CONFIANCE, "basse"),
    base: str(d.base),
  } : null;

  const people = (list, mode) => arr(list).slice(0, 8).map((p) => {
    const base = { name: str(p?.name), role: str(p?.role) };
    if (mode === "relation") base.relation = oneOf(p?.relation, RELATIONS, "pair");
    else base.pourquoi = str(p?.pourquoi);
    return base;
  }).filter((p) => p.name);

  const ent = raw.entourage && typeof raw.entourage === "object" ? raw.entourage : {};

  return {
    synthese_approche: str(raw.synthese_approche),
    changements_recents,
    accroches,
    disc,
    entourage: {
      equipe: people(ent.equipe, "relation"),
      decideurs: people(ent.decideurs, "pourquoi"),
      contacts_secondaires: people(ent.contacts_secondaires, "pourquoi"),
    },
    sources: arr(raw.sources).filter((u) => typeof u === "string" && u.startsWith("http")),
  };
}

export function validateLinkedinImport(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Réponse LLM non-objet.");
  return {
    first_name: str(raw.first_name),
    last_name: str(raw.last_name),
    role: str(raw.role),
    company: str(raw.company),
    company_website: str(raw.company_website),
    confidence: oneOf(raw.confidence, LINKEDIN_CONFIDENCE, "basse"),
    notes: str(raw.notes),
    sources: arr(raw.sources).filter((u) => typeof u === "string" && u.startsWith("http")),
  };
}
