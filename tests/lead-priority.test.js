import { describe, it, expect } from "vitest";
import { computeLeadPriority, sortByPriority, isNewLead, isMissingFromLastImport, leadAngle } from "@/lib/lead-priority";
import { latestFinances, healthFields } from "@/lib/leads-import";

const lead = (detail, extra = {}) => ({
  sf_lead_status: "New",
  health_status: "active",
  health_detail: { siren: "123456789", match_confidence: "sure", ...detail },
  ...extra,
});

describe("computeLeadPriority", () => {
  it("classe A une PME industrielle de 50-99 salariés", () => {
    const p = computeLeadPriority(lead({ effectif: "21", naf: "25.62B", categorie: "PME", etablissements: 3, ca: 12e6, ca_annee: "2024" }));
    expect(p.tier).toBe("A");
    expect(p.score).toBeGreaterThanOrEqual(60);
    expect(p.reasons.some((r) => r.includes("50-199"))).toBe(true);
    expect(p.angle).toMatch(/Industrie/);
  });

  it("pénalise une holding sans salarié", () => {
    const p = computeLeadPriority(lead({ effectif: "NN", naf: "64.20Z", categorie: "PME" }));
    expect(p.tier).toBe("C");
    expect(p.flags.join()).toMatch(/Holding/);
  });

  it("signale un acheteur public (communauté de communes)", () => {
    const p = computeLeadPriority(lead({ effectif: "21", naf: "84.11Z", nature_juridique: "7346" }));
    expect(p.flags.join()).toMatch(/Acheteur public/);
    expect(p.angle).toMatch(/marché/);
  });

  it("accepte les codes d'effectif courts (« 3 ») comme longs (« 03 »)", () => {
    const a = computeLeadPriority(lead({ effectif: "3", naf: "62.01Z" }));
    const b = computeLeadPriority(lead({ effectif: "03", naf: "62.01Z" }));
    expect(a.score).toBe(b.score);
  });

  it("exclut les leads clos et les sociétés fermées", () => {
    expect(computeLeadPriority(lead({}, { sf_lead_status: "Closed by Sales" })).tier).toBe("X");
    expect(computeLeadPriority(lead({}, { health_status: "fermee" })).tier).toBe("X");
  });

  it("met en C, sans planter, un lead sans SIREN", () => {
    const p = computeLeadPriority({ sf_lead_status: "New", health_status: "introuvable", health_detail: null });
    expect(p.tier).toBe("C");
  });

  it("pénalise une procédure collective et un rapprochement probable", () => {
    const base = computeLeadPriority(lead({ effectif: "21", naf: "62.01Z" }));
    const vig = computeLeadPriority(lead({ effectif: "21", naf: "62.01Z" }, { health_status: "vigilance" }));
    const prob = computeLeadPriority(lead({ effectif: "21", naf: "62.01Z", match_confidence: "probable" }));
    expect(vig.score).toBeLessThan(base.score);
    expect(prob.score).toBeLessThan(base.score);
  });

  it("donne un bonus aux leads Working", () => {
    const n = computeLeadPriority(lead({ effectif: "12", naf: "46.69B" }));
    const w = computeLeadPriority(lead({ effectif: "12", naf: "46.69B" }, { sf_lead_status: "Working" }));
    expect(w.score).toBe(n.score + 5);
  });

  it("borne le score entre 0 et 100", () => {
    const p = computeLeadPriority(lead({ effectif: "01", naf: "64.20Z", nature_juridique: "9220", match_confidence: "probable" }, { health_status: "vigilance" }));
    expect(p.score).toBe(0);
  });
});

describe("tri et suivi hebdomadaire", () => {
  it("trie A > B > C > X puis par score", () => {
    const rows = [
      { name: "c", priority: { tier: "C", score: 30 } },
      { name: "x", priority: { tier: "X", score: 0 } },
      { name: "a2", priority: { tier: "A", score: 61 } },
      { name: "a1", priority: { tier: "A", score: 80 } },
      { name: "b", priority: { tier: "B", score: 45 } },
    ];
    expect(sortByPriority(rows).map((r) => r.name)).toEqual(["a1", "a2", "b", "c", "x"]);
  });

  it("repère les nouveaux leads (7 jours)", () => {
    const now = Date.parse("2026-11-20T10:00:00Z");
    expect(isNewLead({ sf_first_seen_at: "2026-11-19T08:00:00Z" }, now)).toBe(true);
    expect(isNewLead({ sf_first_seen_at: "2026-11-05T08:00:00Z" }, now)).toBe(false);
    expect(isNewLead({}, now)).toBe(false);
  });

  it("repère les leads absents du dernier import (tolérance 12 h)", () => {
    const last = "2026-11-19T09:00:00Z";
    expect(isMissingFromLastImport({ sf_last_seen_at: "2026-11-12T09:00:00Z" }, last)).toBe(true);
    expect(isMissingFromLastImport({ sf_last_seen_at: "2026-11-19T08:40:00Z" }, last)).toBe(false);
    expect(isMissingFromLastImport({}, last)).toBe(false);
  });
});

describe("données SIRENE pour la priorité", () => {
  it("prend le dernier exercice avec un CA publié", () => {
    expect(latestFinances({ "2022": { ca: 1000 }, "2023": { ca: null }, "2021": { ca: 500 } })).toEqual({ ca: 1000, ca_annee: "2022" });
    expect(latestFinances(null)).toEqual({ ca: null, ca_annee: null });
  });

  it("healthFields stocke nature juridique, établissements et CA", () => {
    const f = healthFields({
      verdict: { status: "active", label: "ok" },
      match: { siren: "123456789", confidence: "sure" },
      sirene: { nom_complet: "ACME", nature_juridique: "5710", nombre_etablissements_ouverts: 4, finances: { "2024": { ca: 3e6 } } },
      bodacc: null,
    });
    expect(f.health_detail).toMatchObject({ nature_juridique: "5710", etablissements: 4, ca: 3e6, ca_annee: "2024" });
  });

  it("propose un angle par défaut orienté infra", () => {
    expect(leadAngle({})).toMatch(/serveurs/);
  });
});
