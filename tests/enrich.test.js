import { describe, it, expect } from "vitest";
import { normalizeNamePart, applyPattern, detectPattern, extractDomain } from "@/lib/enrich";

describe("normalizeNamePart", () => {
  it("supprime les accents et met en minuscules (convention email FR)", () => {
    expect(normalizeNamePart("Éric")).toBe("eric");
    expect(normalizeNamePart("Hélène")).toBe("helene");
  });
  it("conserve les tirets des prénoms composés, retire le reste", () => {
    expect(normalizeNamePart("Jean-Pierre")).toBe("jean-pierre");
    expect(normalizeNamePart("O'Brien")).toBe("obrien");
  });
});

describe("applyPattern / detectPattern", () => {
  it("applique les patterns usuels", () => {
    expect(applyPattern("prenom.nom", "Marie", "Durand")).toBe("marie.durand");
    expect(applyPattern("p.nom", "Marie", "Durand")).toBe("m.durand");
    expect(applyPattern("pnom", "Marie", "Durand")).toBe("mdurand");
  });
  it("retourne null sans nom exploitable", () => {
    expect(applyPattern("prenom.nom", "", "Durand")).toBeNull();
  });
  it("retrouve le pattern depuis l'email d'un collègue", () => {
    expect(detectPattern("marie.durand@acme.fr", "Marie", "Durand")).toBe("prenom.nom");
    expect(detectPattern("mdurand@acme.fr", "Marie", "Durand")).toBe("pnom");
    expect(detectPattern("contact@acme.fr", "Marie", "Durand")).toBeNull();
  });
  it("cycle complet : pattern détecté sur A puis appliqué à B", () => {
    const p = detectPattern("j.dupont@acme.fr", "Jean", "Dupont");
    expect(applyPattern(p, "Hélène", "Martin")).toBe("h.martin");
  });
});

describe("extractDomain", () => {
  it("extrait le domaine d'une URL", () => {
    expect(extractDomain("https://www.acme.fr/contact?x=1")).toBe("acme.fr");
    expect(extractDomain("acme.fr")).toBe("acme.fr");
  });
  it("rejette les entrées invalides", () => {
    expect(extractDomain("")).toBeNull();
    expect(extractDomain("pas un domaine")).toBeNull();
  });
});
