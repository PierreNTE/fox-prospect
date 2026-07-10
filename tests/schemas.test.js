import { describe, it, expect } from "vitest";
import { validateResearch, validateGenerate } from "@/lib/schemas";
import { dataQualityLevel } from "@/lib/constants";

describe("validateResearch — coercitions", () => {
  it("borne fit_score dans [0,100] et neutralise les valeurs non numériques", () => {
    expect(validateResearch({ fit_score: 150 }).fit_score).toBe(100);
    expect(validateResearch({ fit_score: -5 }).fit_score).toBe(0);
    expect(validateResearch({ fit_score: "85%" }).fit_score).toBe(0);
  });

  it("force les types de signaux dans l'enum, limite les hooks à 3", () => {
    const r = validateResearch({
      signals: [{ type: "invention_du_llm", detail: "x" }],
      hooks: [{}, {}, {}, {}, {}],
    });
    expect(r.signals[0].type).toBe("autre");
    expect(r.hooks).toHaveLength(3);
  });

  it("ne garde que les sources http(s)", () => {
    const r = validateResearch({ sources: ["https://ok.fr", "javascript:alert(1)", 42] });
    expect(r.sources).toEqual(["https://ok.fr"]);
  });
});

describe("validateGenerate", () => {
  it("tronque le message LinkedIn à 300 caractères", () => {
    const r = validateGenerate({ linkedin_message: "x".repeat(500) });
    expect(r.linkedin_message).toHaveLength(300);
  });
});

describe("dataQualityLevel", () => {
  it("aucune coordonnée → non fiable", () => {
    expect(dataQualityLevel({})).toBe("non_fiable");
  });
  it("email haute confiance → vérifié", () => {
    expect(dataQualityLevel({ email: "a@b.fr", email_confidence: "haute" })).toBe("verifie");
  });
  it("email déduit sans téléphone → non fiable ; avec téléphone → à confirmer", () => {
    expect(dataQualityLevel({ email: "a@b.fr", email_confidence: "déduit" })).toBe("non_fiable");
    expect(dataQualityLevel({ email: "a@b.fr", email_confidence: "déduit", phone: "+33" })).toBe("a_confirmer");
  });
});
