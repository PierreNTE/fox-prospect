import { describe, it, expect } from "vitest";
import { whoToCall, pickStandard, prettyName, phoneSearchUrl } from "@/lib/who-to-call";
import { normalizeLeadStatus } from "@/lib/salesforce-leads";
import { selectPhoneTargets } from "@/lib/leads-agent";
import { sfStatusLabel } from "@/lib/call-status";

const base = { id: "a1", name: "ALPHA MOTORS SAS", health_status: "active", health_detail: { sirene_name: "ALPHA MOTORS", commune: "ANGERS" } };

describe("qui appeler", () => {
  it("contact informatique d'abord, puis dirigeant, sans doublon", () => {
    const account = { ...base, health_detail: { ...base.health_detail, dirigeants: [{ name: "JEAN MARTIN", role: "Président" }, { name: "Alex Durand", role: "Gérant" }] } };
    const contacts = [
      { id: "c1", first_name: "Alex", last_name: "Durand", role: "Directeur commercial" },
      { id: "c2", first_name: "Sam", last_name: "Petit", role: "Responsable informatique", phone: "02 41 00 00 03" },
    ];
    const w = whoToCall({ account, contacts });
    expect(w.people.map((p) => p.name)).toEqual(["Sam Petit", "Alex Durand", "Jean Martin"]);
    expect(w.people[0].kind).toBe("it");
    expect(w.people[2].source).toBe("Dirigeant légal (RNE)");
  });
  it("dirigeant de la maison mère quand la société n'a pas de dirigeant personne", () => {
    const account = { ...base, web_intel: { groupe_dirigeants: [{ name: "Lou Bernard", role: "Président", company: "HOLDING GAMMA" }] } };
    const w = whoToCall({ account });
    expect(w.people[0]).toMatchObject({ name: "Lou Bernard", role: "Président de HOLDING GAMMA", kind: "groupe" });
  });
  it("standard : saisi > site > fiche > recherche web, et toujours un lien de recherche", () => {
    expect(pickStandard({ standard_phone: "02 41 11 11 11", standard_source: "manuel", web_intel: { phones: [{ number: "02 41 22 22 22", kind: "fixe" }] } }))
      .toEqual({ number: "02 41 11 11 11", source: "saisi par toi" });
    expect(pickStandard({ standard_phone: "02 41 33 33 33", standard_source: "recherche web (2 sources), à vérifier", web_intel: { phones: [{ number: "02 41 22 22 22", kind: "fixe" }] } }).number)
      .toBe("02 41 22 22 22");
    expect(pickStandard({ standard_phone: "02 41 33 33 33", standard_source: "recherche web (1 source), à vérifier" }).source).toMatch(/recherche web/);
    expect(pickStandard({})).toBeNull();
    expect(phoneSearchUrl(base)).toContain(encodeURIComponent("ALPHA MOTORS ANGERS téléphone"));
  });
  it("noms remis en forme", () => {
    expect(prettyName("JEAN-PIERRE DE LA FONTAINE")).toBe("Jean-Pierre De La Fontaine");
  });
});

describe("statut Salesforce", () => {
  it("cellule coupée par le PDF ramenée au statut complet", () => {
    expect(normalizeLeadStatus("N")).toBe("New");
    expect(normalizeLeadStatus("Work")).toBe("Working");
    expect(normalizeLeadStatus("Closed by")).toBe("Closed by Sales");
    expect(normalizeLeadStatus("working")).toBe("Working");
    expect(normalizeLeadStatus("Autre")).toBe("Autre");
    expect(sfStatusLabel("New")).toBe("Nouveau");
  });
});

describe("recherche des standards", () => {
  it("tous les leads actifs sans numéro, une seule fois", () => {
    const leads = [
      { id: "1", health_status: "active", standard: null },
      { id: "2", health_status: "active", standard: { number: "02 41 00 00 00" } },
      { id: "3", health_status: "fermee", standard: null },
      { id: "4", health_status: "active", standard: null, sf_lead_status: "Closed by Sales" },
      { id: "5", health_status: "vigilance", standard: null },
      { id: "6", health_status: "active", standard: null },
    ];
    expect(selectPhoneTargets(leads, { room: 10, already: new Set(["6"]) }).map((l) => l.id)).toEqual(["1", "5"]);
  });
});

import { pickEmail } from "@/lib/who-to-call";
import { buildExportRows, toCsv, buildAgentInstructions } from "@/lib/sales-chat";
import { selectEmailTargets } from "@/lib/leads-agent";

describe("email à utiliser", () => {
  it("saisi > vu sur le site > motif observé > recherche web > supposé", () => {
    const w = {
      emails: { generic: ["contact@alpha.fr"], named: [] },
      leaders_emails: [{ name: "Jean Martin", role: "Président", email: "jean.martin@alpha.fr", confidence: "motif observé" }],
      dns: { has_mx: true },
    };
    expect(pickEmail({ account: { web_intel: w } })).toMatchObject({ email: "contact@alpha.fr", confidence: "sûr", generic: true });
    expect(pickEmail({ account: { web_intel: w, found_email: "it@alpha.fr", found_email_source: "manuel" } }))
      .toMatchObject({ email: "it@alpha.fr", source: "saisi par toi" });
    expect(pickEmail({ account: { web_intel: { leaders_emails: w.leaders_emails } } })).toMatchObject({ confidence: "probable", name: "Jean Martin" });
    expect(pickEmail({ account: { found_email: "alpha@orange.fr", found_email_source: "recherche web (1 source)" } }).confidence).toBe("supposé");
    expect(pickEmail({ account: { found_email: "alpha@orange.fr", found_email_source: "recherche web (3 sources)" } }).confidence).toBe("probable");
    expect(pickEmail({ account: { domain: "alpha.fr", web_intel: { dns: { has_mx: true } } } })).toMatchObject({ email: "contact@alpha.fr", confidence: "supposé" });
    expect(pickEmail({ account: {} })).toBeNull();
  });
  it("contact informatique du compte en premier", () => {
    const contacts = [
      { first_name: "Léa", last_name: "Roux", role: "Comptable", email: "lea@alpha.fr" },
      { first_name: "Sam", last_name: "Petit", role: "Responsable informatique", email: "sam@alpha.fr" },
    ];
    expect(pickEmail({ account: {}, contacts }).email).toBe("sam@alpha.fr");
  });
});

describe("export Sales Chat", () => {
  const lead = (o) => ({ id: "x", name: "ALPHA SAS", health_status: "active", email: { email: "contact@alpha.fr", confidence: "sûr", generic: true, source: "site" }, ...o });
  it("garde les leads actifs avec email, hors RDV / pas intéressé / déjà exportés", () => {
    const now = Date.parse("2026-11-24T08:00:00Z");
    const rows = buildExportRows([
      lead({ id: "1" }),
      lead({ id: "2", call_status: "rdv" }),
      lead({ id: "3", email: null }),
      lead({ id: "4", email_exported_at: "2026-11-20T08:00:00Z" }),
      lead({ id: "5", email_exported_at: "2026-10-01T08:00:00Z" }),
      lead({ id: "6", health_status: "fermee" }),
    ], { now, baseUrl: "https://app.test" });
    expect(rows.map((r) => r.id)).toEqual(["1", "5"]);
    expect(rows[0]).toMatchObject({ email_generique: "oui", destinataire: "", fiche: "https://app.test/accounts/1" });
  });
  it("CSV lisible par Excel (BOM, ;, guillemets échappés)", () => {
    const csv = toCsv([{ societe: 'ALPHA "SAS"', email: "a@b.fr" }], [["societe", "Société"], ["email", "Email"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Société";"Email"');
    expect(csv).toContain('"ALPHA ""SAS""";"a@b.fr"');
  });
  it("instructions signées, mode validation par défaut, désinscription", () => {
    const t = buildAgentInstructions({ senderName: "Alex Martin", senderRole: "Account Executive" });
    expect(t).toContain("Alex Martin, Account Executive chez Dell Technologies");
    expect(t).toContain("MODE = VALIDATION");
    expect(t).toContain("STOP");
  });
  it("recherche d'email pour les leads sans email sûr ou probable", () => {
    const leads = [
      { id: "1", health_status: "active", email: null },
      { id: "2", health_status: "active", email: { confidence: "supposé" } },
      { id: "3", health_status: "active", email: { confidence: "sûr" } },
      { id: "4", health_status: "fermee", email: null },
    ];
    expect(selectEmailTargets(leads, { room: 10, already: new Set(["2"]) }).map((l) => l.id)).toEqual(["1"]);
  });
});
