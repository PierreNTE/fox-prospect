// QW4 — validateurs légers pour toutes les sorties LLM.
// Sans dépendance externe : coerce les valeurs dans les types et enums attendus
// plutôt que de rejeter — une réponse partiellement correcte vaut mieux qu'une 500.

import {
  SIGNAL_TYPES, RELIABILITY, ROLE_CONFIDENCE, EMAIL_CONFIDENCE, LINKEDIN_CONFIDENCE,
} from "@/lib/constants";

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
  const news = arr(raw.news).map((n) => ({
    title: str(n?.title),
    date: str(n?.date),
    source: str(n?.source),
    url: str(n?.url),
  }));
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
    responsibilities: str(p?.responsibilities),
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
