import { describe, it, expect } from "vitest";
import { buildCallBrief, levenshtein, deptOf, phoneMatchesDept, sharedDomains } from "@/lib/call-brief";
import { parseSalesforcePaste } from "@/lib/sf-paste";
import { pickStandard } from "@/lib/who-to-call";

const NOW = new Date("2026-11-24T10:00:00Z");
const base = (o = {}) => ({
  id: "x", name: "ALPHA SAS", health_status: "active",
  health_detail: { siren: "123456789", sirene_name: "ALPHA", commune: "ANGERS", siege_cp: "49100", naf: "62.01Z", effectif: "12" },
  web_intel: { phones: [{ number: "02 41 00 00 01", kind: "fixe" }] },
  ...o,
});

describe("brief d'appel", () => {
  it("lead sain : à appeler, note Salesforce en 5 lignes", () => {
    const b = buildCallBrief(base(), { now: NOW });
    expect(b.verdict).toBe("appeler");
    expect(b.anomalies).toEqual([]);
    expect(b.sfNote.split("\n")).toHaveLength(5);
    expect(b.sfNote).toContain("SIREN 123 456 789");
    expect(b.sfNote).toContain("standard 02 41 00 00 01");
  });
  it("holding 64.20Z avec 1 à 2 salariés → faible potentiel", () => {
    const b = buildCallBrief(base({ health_detail: { ...base().health_detail, naf: "64.20Z", effectif: "01" } }), { now: NOW });
    expect(b.anomalies.map((a) => a.code)).toContain("LOW_POTENTIAL");
    expect(b.verdict).toBe("faible");
    expect(b.openingQuestion).toMatch(/holding/);
  });
  it("établissement secondaire d'une association → décision au siège", () => {
    const b = buildCallBrief(base({ health_detail: { ...base().health_detail, est_association: true, etablissements: 12,
      etab_match: { siret: "12345678900042", code_postal: "49000", commune: "ANGERS", est_siege: false }, commune: "PARIS", siege_cp: "75011" },
      web_intel: { phones: [{ number: "02 41 00 00 01", kind: "fixe" }] } }), { now: NOW });
    expect(b.anomalies.map((a) => a.code)).toContain("HQ_DECIDES");
    expect(b.openingQuestion).toMatch(/siège/);
    expect(b.anomalies.map((a) => a.code)).not.toContain("PHONE_AREA_MISMATCH"); // 02 = Angers, l'établissement
  });
  it("indicatif d'une autre région que le siège → à vérifier", () => {
    const b = buildCallBrief(base({ web_intel: { phones: [{ number: "04 72 00 00 00", kind: "fixe" }] } }), { now: NOW });
    expect(b.anomalies.map((a) => a.code)).toContain("PHONE_AREA_MISMATCH");
    expect(b.verdict).toBe("verifier");
  });
  it("numéro non attribué ou aucun numéro → aucun numéro valide", () => {
    expect(buildCallBrief(base({ call_status: "faux_numero" }), { now: NOW }).anomalies.map((a) => a.code)).toContain("NO_VALID_PHONE");
    expect(buildCallBrief(base({ web_intel: {} }), { now: NOW }).anomalies.map((a) => a.code)).toContain("NO_VALID_PHONE");
  });
  it("société fermée sans repreneur → à clôturer", () => {
    expect(buildCallBrief(base({ health_status: "fermee" }), { now: NOW }).verdict).toBe("cloturer");
  });
  it("anomalies de la fiche Salesforce collée reprises dans le brief", () => {
    const b = buildCallBrief(base({ sf_paste_flags: { code_postal: "13001", commune: "MARSEILLE", flags: [
      { code: "ADDR_MISMATCH", detail: "Salesforce : 13001 · SIRENE : siège 49100 ANGERS" },
      { code: "EMAIL_DOMAIN_TYPO", detail: "alpah.fr au lieu de alpha.fr" },
    ] } }), { now: NOW });
    expect(b.anomalies.map((a) => a.code)).toEqual(["ADDR_MISMATCH", "EMAIL_DOMAIN_TYPO"]);
    expect(b.sf_fix).toBe(true);
    expect(b.sfNote).toContain("fiche Salesforce : 13001 MARSEILLE");
  });
  it("domaine email partagé entre plusieurs sociétés", () => {
    const leads = [
      { id: "1", health_detail: { siren: "111111111" }, email: { email: "a@reseau.asso.fr" } },
      { id: "2", health_detail: { siren: "222222222" }, email: { email: "b@reseau.asso.fr" } },
      { id: "3", health_detail: { siren: "333333333" }, email: { email: "c@gmail.com" } },
      { id: "4", health_detail: { siren: "333333333" }, email: { email: "d@gmail.com" } },
    ];
    const shared = sharedDomains(leads);
    expect([...shared]).toEqual(["reseau.asso.fr"]);
    const b = buildCallBrief(base({ email: { email: "a@reseau.asso.fr" } }), { shared, now: NOW });
    expect(b.anomalies.map((a) => a.code)).toContain("SHARED_DOMAIN");
  });
});

describe("outils", () => {
  it("Levenshtein, départements, zones d'indicatifs", () => {
    expect(levenshtein("exemplr.asso.fr", "exemple.asso.fr")).toBe(1);
    expect(deptOf("20090")).toBe("2A");
    expect(deptOf("97400")).toBe("974");
    expect(phoneMatchesDept("01 41 00 00 00", "92")).toBe(true);
    expect(phoneMatchesDept("04 72 00 00 00", "92")).toBe(false);
    expect(phoneMatchesDept("06 12 34 56 78", "92")).toBeNull();
  });
  it("numéro non attribué écarté du standard", () => {
    const acc = { web_intel: { phones: [{ number: "02 41 00 00 01", kind: "fixe" }] }, standard_phone: "02 41 00 00 09", bad_phones: ["02 41 00 00 01"] };
    expect(pickStandard(acc).number).toBe("02 41 00 00 09");
  });
});

describe("fiche Salesforce collée (analysée dans le navigateur)", () => {
  const PASTE = [
    "Lead", "ALPHA SAS",
    "Adresse", "12 rue des Lilas", "Code postal", "13001", "Ville", "Marseille",
    "Téléphone\t03 88 00 00 00",
    "E-mail\tjean.dupont@alpah.fr",
    "Email générique : contact@alpha.fr",
    "Propriétaire du lead\tCollègue Dell", "Créé par\tcollegue@dell.com 12/03/2016",
    "Description", "15/06/2016 - Pas de besoin pour le moment",
    "Activité : appel 02/02/2017",
  ].join("\n");
  it("lit l'adresse, garde les emails génériques et les domaines, jamais les nominatifs", () => {
    const p = parseSalesforcePaste(PASTE, { siegeCp: "49100", now: NOW });
    expect(p).toMatchObject({ code_postal: "13001", commune: "Marseille", rue: "12 rue des Lilas" });
    expect(p.generic_emails).toEqual(["contact@alpha.fr"]);
    expect(p.domains).toEqual(["alpah.fr", "alpha.fr"]);
    expect(JSON.stringify(p)).not.toContain("jean.dupont");
    expect(JSON.stringify(p)).not.toContain("Collègue");
  });
  it("note de plus de 2 ans et indicatif d'une autre région", () => {
    const p = parseSalesforcePaste(PASTE, { siegeCp: "49100", now: NOW });
    expect(p.flags.map((f) => f.code)).toEqual(["NOTE_STALE", "PHONE_AREA_MISMATCH"]);
    expect(p.flags[0].detail).toContain("02/02/2017");
    expect(p.flags[1].detail).not.toContain("88 00 00 00");
  });
});
