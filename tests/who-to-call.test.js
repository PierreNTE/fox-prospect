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

import { pickEmail, foundEmailIssue, pickRecipient, personalizeEmail, splitName, whoToCall } from "@/lib/who-to-call";
import { buildExportRows, toCsv, buildAgentInstructions } from "@/lib/sales-chat";
import { selectEmailTargets, emailJobParams } from "@/lib/leads-agent";

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
    expect(pickEmail({ account: { name: "ALPHA SAS", found_email: "alpha@orange.fr", found_email_source: "recherche web (1 source)" } }).confidence).toBe("supposé");
    expect(pickEmail({ account: { name: "ALPHA SAS", found_email: "alpha@orange.fr", found_email_source: "recherche web (3 sources)" } }).confidence).toBe("probable");
    expect(pickEmail({ account: { name: "ALPHA SAS", found_email: "contact@alpha.fr", found_email_source: "recherche web (1 source)" } }).confidence).toBe("probable");
    expect(pickEmail({ account: { domain: "alpha.fr", web_intel: { dns: { has_mx: true } } } })).toMatchObject({ email: "contact@alpha.fr", confidence: "supposé" });
    expect(pickEmail({ account: {} })).toBeNull();
  });
  it("écarte les emails d'une autre société, de recrutement ou perso", () => {
    const base = { name: "ALPHA SAS", domain: "alpha.fr", web_intel: { dns: { has_mx: true } } };
    for (const bad of ["contact@ecole-beta.fr", "recrutement@alpha.fr", "jean.alpha@gmail.com", "alpha.germany@alpha-europe.com"]) {
      expect(pickEmail({ account: { ...base, found_email: bad, found_email_source: "recherche web (2 sources)" } }).email).toBe("contact@alpha.fr");
      expect(foundEmailIssue({ ...base, found_email: bad, found_email_source: "recherche web (2 sources)" })).toBeTruthy();
    }
    expect(foundEmailIssue({ ...base, found_email: "info@alpha.fr", found_email_source: "recherche web (1 source)" })).toBeNull();
  });
  it("contact informatique du compte en premier", () => {
    const contacts = [
      { first_name: "Léa", last_name: "Roux", role: "Comptable", email: "lea@alpha.fr" },
      { first_name: "Sam", last_name: "Petit", role: "Responsable informatique", email: "sam@alpha.fr" },
    ];
    expect(pickEmail({ account: {}, contacts }).email).toBe("sam@alpha.fr");
  });
});

describe("destinataire nommé", () => {
  it("prénom et nom d'usage depuis le RNE", () => {
    expect(splitName("MARC ANTOINE DUBOIS")).toEqual({ first: "Marc", last: "Dubois" });
    expect(splitName("CLAIRE ANNE LEMOINE (MARTIN)")).toEqual({ first: "Claire", last: "Lemoine" });
    expect(splitName("Jean de la Fontaine")).toEqual({ first: "Jean", last: "De La Fontaine" });
  });
  it("informatique d'abord, puis le dirigeant, puis un autre contact", () => {
    const who = whoToCall({
      account: { health_detail: { dirigeants: [{ name: "PAUL ANDRE LEROY", role: "Gérant" }] } },
      contacts: [{ first_name: "Léa", last_name: "Roux", role: "Comptable" }],
    });
    expect(pickRecipient(who.people)).toMatchObject({ name: "Paul Leroy", role: "Gérant" });
    const it = whoToCall({ account: {}, contacts: [{ first_name: "Sam Max", last_name: "Petit", role: "DSI" }] });
    expect(pickRecipient(it.people)).toMatchObject({ name: "Sam Petit", role: "DSI" });
    expect(pickRecipient([])).toBeNull();
  });
  it("personnalise le message", () => {
    const r = { name: "Paul Leroy", role: "Gérant" };
    expect(personalizeEmail("Bonjour,\n\nJ'espère que vous allez bien.", r)).toBe("Bonjour Paul Leroy,\n\nJ'espère que vous allez bien.");
    const g = personalizeEmail("Bonjour,\n\nPourriez-vous transmettre ce message à la personne en charge de l'informatique ?", r, { generic: true });
    expect(g.startsWith("À l'attention de Paul Leroy, Gérant\n\nBonjour Paul Leroy,")).toBe(true);
    expect(g).toContain("à Paul Leroy ou à la personne en charge de l'informatique");
    expect(personalizeEmail("Bonjour,", null)).toBe("Bonjour,");
  });
});

describe("export Sales Chat", () => {
  const lead = (o) => ({ id: "x", name: "ALPHA SAS", health_status: "active", recipient: { name: "Jean Martin", role: "Gérant" },
    email: { email: "contact@alpha.fr", confidence: "sûr", generic: true, source: "site" }, ...o });
  it("garde les leads actifs, hors RDV / pas intéressé / déjà exportés ; sans email = à trouver", () => {
    const now = Date.parse("2026-11-24T08:00:00Z");
    const rows = buildExportRows([
      lead({ id: "1" }),
      lead({ id: "2", call_status: "rdv" }),
      lead({ id: "3", email: null }),
      lead({ id: "4", email_exported_at: "2026-11-20T08:00:00Z" }),
      lead({ id: "5", email_exported_at: "2026-10-01T08:00:00Z" }),
      lead({ id: "6", health_status: "fermee" }),
      lead({ id: "7", recipient: null }), // sans nom : ne part pas
      lead({ id: "8", last_email_at: "2026-11-21T08:00:00Z" }), // déjà écrit il y a 3 jours
      lead({ id: "9", email_replied: true }), // a répondu : à reprendre soi-même
    ], { now, baseUrl: "https://app.test" });
    expect(rows.map((r) => r.id)).toEqual(["1", "3", "5"]);
    expect(rows[0]).toMatchObject({ email_generique: "oui", destinataire: "Jean Martin", poste: "Gérant", fiche: "https://app.test/accounts/1" });
    expect(rows[1]).toMatchObject({ email: "", confiance_email: "à trouver" });
    const all = buildExportRows([lead({ id: "8", last_email_at: "2026-11-21T08:00:00Z" })], { now, all: true });
    expect(all).toEqual([]); // même « tout re-télécharger » ne renvoie pas un email écrit il y a moins de 25 jours
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
    expect(t).toContain("DELL : Données et Sauvegardes");
    expect(t).toContain("[ton téléphone]");
  });
  it("recherche d'email (et de nom) pour les leads sans email sûr, sans nom ou à l'email écarté", () => {
    const r = { name: "Jean Martin" };
    const leads = [
      { id: "1", health_status: "active", email: null, recipient: r },
      { id: "2", health_status: "active", email: { confidence: "supposé" }, recipient: r },
      { id: "3", health_status: "active", email: { confidence: "sûr" }, recipient: r },
      { id: "4", health_status: "fermee", email: null },
      { id: "5", health_status: "active", email: { confidence: "sûr" }, recipient: null },
      { id: "6", health_status: "active", email: { confidence: "sûr" }, recipient: r, email_issue: "domaine d'une autre organisation" },
    ];
    expect(selectEmailTargets(leads, { room: 10, already: new Set(["2"]) }).map((l) => l.id)).toEqual(["1", "5", "6"]);
    const p = emailJobParams({ ...leads[5], found_email: "x@y.fr", groupe: { siren: "123456789" }, nature_juridique: "9220" });
    expect(p).toMatchObject({ v: 3, need_name: false, email_replace: true, bad_email: "x@y.fr", groupe_siren: "123456789", association: true });
  });
  it("instructions : toujours un nom", () => {
    const t = buildAgentInstructions({ senderName: "Alex Martin" });
    expect(t).toContain("Jamais « Bonjour, » seul");
    expect(t).toContain("À l'attention de [Prénom Nom]");
  });
});

import { buildFreeCallPrep } from "@/lib/call-prep-free";

describe("email au style de Pierre", () => {
  it("objet DELL :, question des sujets en cours, numéro direct", () => {
    const p = buildFreeCallPrep({
      account: { id: "z", name: "GAMMA SAS", health_detail: { commune: "ANGERS" } },
      sender: { sender_name: "Alex Martin", sender_role: "Inside Sales", sender_phone: "06 00 00 00 00" },
    });
    expect(p.messages.email.objet).toBe("DELL : Données et Sauvegardes");
    expect(p.messages.email.corps).toContain("y a-t-il un sujet en cours (extension, renouvellement, incident)");
    expect(p.messages.email.corps).toContain("Vous pouvez aussi m'appeler directement au 06 00 00 00 00.");
    expect(p.messages.email.corps).toContain("Alex Martin\nInside Sales\nDell Technologies\nTél. : 06 00 00 00 00");
    expect(p.messages.relance.corps).toContain("un simple nom me suffit");
  });
});

import { contactJobParams, CONTACT_SEARCH_VERSION } from "@/lib/leads-agent";

describe("recherche élargie des coordonnées", () => {
  it("paramètres : nom Salesforce, SIREN, acheteur public, établissement, domaine, version", () => {
    const p = contactJobParams({ id: "1", name: "MAIRIE DE GAMMA", sirene_name: "COMMUNE DE GAMMA", commune: "GAMMA",
      siren: "210000000", nature_juridique: "7210", etab_commune: "BETA", website: "https://www.gamma.fr/accueil" });
    expect(p).toMatchObject({ company: "COMMUNE DE GAMMA", alt: "MAIRIE DE GAMMA", siren: "210000000", public: true,
      etab_commune: "BETA", domain: "gamma.fr", v: CONTACT_SEARCH_VERSION });
    expect(contactJobParams({ id: "2", name: "ALPHA SAS", sirene_name: "ALPHA SAS", nature_juridique: "5710" }))
      .toMatchObject({ alt: null, public: false, domain: null });
  });
});
