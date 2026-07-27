import { describe, it, expect } from "vitest";
import { computeScores, computeAccountHeat } from "@/lib/scoring";

// Horloge fixe pour des tests déterministes : 15 juin 2026.
const NOW = new Date(2026, 5, 15).getTime();

describe("computeScores — urgence", () => {
  it("retourne 0 d'urgence sans signal, avec gate à 0.5", () => {
    const s = computeScores({ prospect: {}, signals: [], firmographics: {}, now: NOW });
    expect(s.urgency_score).toBe(0);
    expect(s.breakdown.gate).toBe(0.5);
  });

  it("un RFP frais donne une urgence maximale", () => {
    const s = computeScores({
      signals: [{ type: "rfp_it", detail: "AO infogérance", date: "2026-06-10" }],
      now: NOW,
    });
    expect(s.urgency_score).toBeGreaterThanOrEqual(90);
  });

  it("un signal ancien pèse beaucoup moins qu'un signal frais", () => {
    const fresh = computeScores({ signals: [{ type: "recrutement", detail: "x", date: "2026-06" }], now: NOW });
    const old = computeScores({ signals: [{ type: "recrutement", detail: "x", date: "2024-06" }], now: NOW });
    expect(fresh.urgency_score).toBeGreaterThan(old.urgency_score * 3);
  });

  it("parse les dates françaises (« mars 2026 »)", () => {
    const s = computeScores({ signals: [{ type: "nomination", detail: "x", date: "mars 2026" }], now: NOW });
    expect(s.urgency_score).toBeGreaterThan(0);
  });

  it("borne le score global entre 0 et 100", () => {
    const s = computeScores({
      prospect: { email: "a@b.fr", email_confidence: "haute", phone: "+33", linkedin_url: "x", role: "RSSI adjoint" },
      signals: Array.from({ length: 10 }, () => ({ type: "rfp_it", detail: "x", date: "2026-06-14", base_weight: 40 })),
      firmographics: { effectif_min: 10000, naf_code: "6419Z" },
      now: NOW,
    });
    expect(s.global_score).toBeLessThanOrEqual(100);
    expect(s.global_score).toBeGreaterThan(50);
  });
});

describe("computeScores — business (firmographie)", () => {
  it("effectif SIRENE → score par tranche", () => {
    expect(computeScores({ firmographics: { effectif_min: 600 }, now: NOW }).business_score).toBe(70);
    expect(computeScores({ firmographics: { effectif_min: 30 }, now: NOW }).business_score).toBe(20);
  });

  it("bonus NAF réglementé (banque = 64)", () => {
    const bank = computeScores({ firmographics: { effectif_min: 600, naf_code: "6419Z" }, now: NOW });
    expect(bank.business_score).toBe(80);
  });

  it("inconnu → défaut médian 50", () => {
    expect(computeScores({ firmographics: {}, now: NOW }).business_score).toBe(50);
  });
});

describe("computeScores — accessibilité", () => {
  it("opposition RGPD → 0", () => {
    const s = computeScores({ prospect: { do_not_contact: true, email: "a@b.fr" }, now: NOW });
    expect(s.accessibility_score).toBe(0);
  });

  it("email haute confiance + téléphone > email déduit seul", () => {
    const strong = computeScores({ prospect: { email: "a@b.fr", email_confidence: "haute", phone: "+33 1" }, now: NOW });
    const weak = computeScores({ prospect: { email: "a@b.fr", email_confidence: "déduit" }, now: NOW });
    expect(strong.accessibility_score).toBeGreaterThan(weak.accessibility_score);
  });
});

describe("computeAccountHeat", () => {
  it("compte sans signaux → 0", () => {
    expect(computeAccountHeat({ signals: [] })).toBe(0);
    expect(computeAccountHeat({})).toBe(0);
  });
});
