import { describe, it, expect, afterEach } from "vitest";
import { aiEnabled } from "@/lib/constants";
import { callClaude } from "@/lib/anthropic";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { buildFreeCallPrep, sizeBand, pickAngle, rolesToTarget } from "@/lib/call-prep-free";
import { parseNewsRss } from "@/lib/news-rss";
import { pickOsm } from "@/lib/account-intel";

const prevAi = process.env.AI_ENABLED;
afterEach(() => { if (prevAi === undefined) delete process.env.AI_ENABLED; else process.env.AI_ENABLED = prevAi; });

describe("interrupteur IA", () => {
  it("coupée par défaut, et aucun appel ne part", async () => {
    delete process.env.AI_ENABLED;
    expect(aiEnabled()).toBe(false);
    await expect(callClaude({ system: "x", user: "y" })).rejects.toThrow(/IA désactivée/);
  });
  it("le kill-switch budget se déclenche sans lire la base", async () => {
    delete process.env.AI_ENABLED;
    const st = await checkMonthlyBudget(null);
    expect(st.exceeded).toBe(true);
    expect(budgetMessage(st)).toMatch(/gratuit/);
  });
  it("réactivable explicitement", () => {
    process.env.AI_ENABLED = "true";
    expect(aiEnabled()).toBe(true);
  });
});

const account = {
  id: "a1", name: "ATELIER DURAND", website: null, domain: "atelier-durand.fr",
  health_detail: {
    siren: "732829320", sirene_name: "ATELIER DURAND", naf: "25.62B", effectif: "12", categorie: "PME",
    commune: "NANTES", etablissements: 2, dirigeants: [{ name: "PAUL DURAND", role: "Président" }],
  },
  web_intel: {
    site: { url: "https://www.atelier-durand.fr/" },
    phones: [{ number: "02 40 11 22 33", kind: "fixe" }],
    emails: { generic: ["contact@atelier-durand.fr"], named: [] },
    tech: [{ label: "VMware", cat: "Virtualisation" }, { label: "Veeam", cat: "Sauvegarde" }],
    dns: { has_mx: true, mail_provider: "Microsoft 365" },
    leaders_emails: [{ name: "PAUL DURAND", email: "paul.durand@atelier-durand.fr", confidence: "motif courant, à vérifier" }],
    news: [{ titre: "Atelier Durand agrandit son usine", date: "2026-05-02", source: "Ouest-France", url: "https://ex.fr/a" }],
  },
};

describe("fiche d'approche gratuite", () => {
  it("rassemble coordonnées, dirigeant, actu, angle et messages sans rien inventer", () => {
    const p = buildFreeCallPrep({ account, contacts: [], sender: { sender_name: "Pierre Logre" } });
    expect(p.mode).toBe("gratuit");
    expect(p.coordonnees).toMatchObject({ site: "https://www.atelier-durand.fr/", standard: "02 40 11 22 33", email_generique: "contact@atelier-durand.fr", domaine_email: "atelier-durand.fr" });
    expect(p.contacts[0]).toMatchObject({ prenom: "Paul", nom: "Durand", source: "Dirigeant légal (RNE)" });
    expect(p.actus[0].titre).toMatch(/agrandit/);
    expect(p.angle).toMatch(/VMware/);
    expect(p.messages.email.corps).toMatch(/^Bonjour Paul,/);
    expect(p.messages.email.corps).toMatch(/Pierre Logre\nDell Technologies$/);
    expect(p.messages.linkedin_invitation.length).toBeLessThanOrEqual(300);
    expect(p.standard.phrases[0]).toMatch(/Pierre de Dell Technologies/);
    expect(p.sources[0]).toMatch(/annuaire-entreprises/);
  });
  it("sans données web : champs vides, pas de valeur inventée", () => {
    const p = buildFreeCallPrep({ account: { id: "b", name: "X SARL", health_detail: { effectif: "01" } } });
    expect(p.coordonnees.site).toBeNull();
    expect(p.coordonnees.standard).toBeNull();
    expect(p.contacts).toEqual([]);
    expect(p.messages.email.corps).toMatch(/^Bonjour,/);
  });
  it("appel d'offres ouvert = accroche prioritaire ; tailles et postes", () => {
    const a = pickAngle({ detail: {}, intel: { public_contracts: [{ ouvert: true, limite: "2099-01-01", objet: "Serveurs" }], tech: [{ label: "VMware" }] } });
    expect(a.key).toBe("appel_offres");
    expect(sizeBand("02")).toBe("tpe");
    expect(sizeBand("21")).toBe("moyenne");
    expect(rolesToTarget("tpe", false)[0]).toMatch(/Gérant/);
    expect(rolesToTarget("moyenne", true)[0]).toMatch(/DGS/);
  });
});

describe("sources gratuites", () => {
  it("actus Google : nom cité d'un bloc dans le titre, récentes", () => {
    const xml = `<rss><channel>
      <item><title>Atelier Durand agrandit son usine - Ouest-France</title><link>https://n/1</link><pubDate>Sat, 02 May 2026 08:00:00 GMT</pubDate><source url="x">Ouest-France</source></item>
      <item><title>Un atelier près de chez Durand - Blog</title><link>https://n/2</link><pubDate>Sat, 02 May 2026 08:00:00 GMT</pubDate><source url="x">Blog</source></item>
      <item><title>Atelier Durand en 2019 - Presse</title><link>https://n/3</link><pubDate>Mon, 01 Apr 2019 08:00:00 GMT</pubDate><source url="x">Presse</source></item>
    </channel></rss>`;
    const n = parseNewsRss(xml, "ATELIER DURAND", { now: Date.parse("2026-11-23") });
    expect(n).toEqual([{ titre: "Atelier Durand agrandit son usine", date: "2026-05-02", source: "Ouest-France", url: "https://n/1" }]);
  });
  it("OpenStreetMap : site et téléphone du bon établissement", () => {
    const r = pickOsm([
      { name: "Boulangerie Martin", osm_type: "node", osm_id: 1, extratags: { website: "https://boulangerie.fr" } },
      { name: "Atelier Durand", osm_type: "way", osm_id: 2, extratags: { "contact:website": "https://atelier-durand.fr", phone: "+33 2 40 11 22 33" } },
    ], "ATELIER DURAND");
    expect(r).toMatchObject({ website: "https://atelier-durand.fr", phone: "+33 2 40 11 22 33" });
    expect(pickOsm([{ name: "Autre chose", extratags: {} }], "ATELIER DURAND")).toBeNull();
  });
});
