import { describe, it, expect } from "vitest";
import {
  extractEmails, extractPhones, formatPhone, extractSocials, pickInternalLinks, textHasSiren, siteMatch,
  detectTech, extractHoster, inferEmailPattern, applyPattern, parseRobots, domainCandidates, rootDomain,
  htmlToText, crawlSite, isGenericEmail,
} from "@/lib/web-intel";
import { classifyDns } from "@/lib/dns-intel";
import { normalizeNotices, isPublicBuyer } from "@/lib/boamp";
import { guessLeaderEmails } from "@/lib/account-intel";

const HOME = `<html><head><title>Atelier Durand – Menuiserie industrielle</title></head><body>
<nav><a href="/contact">Nous contacter</a> <a href="/mentions-legales">Mentions légales</a>
<a href="/recrutement">Rejoignez-nous</a> <a href="https://autre-site.fr/contact">Partenaire</a></nav>
<footer>Tél. <a href="tel:+33240112233">02 40 11 22 33</a> · contact [at] atelier-durand.fr
<a href="https://www.linkedin.com/company/atelier-durand/">LinkedIn</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">partager</a></footer></body></html>`;
const MENTIONS = `<h1>Mentions légales</h1><p>Atelier Durand SAS, RCS Nantes 732 829 320, capital 50 000 €.
Directeur de la publication : Paul Durand. Contact : p.durand@atelier-durand.fr — 02 40 11 22 33.
Hébergeur : OVH SAS, 2 rue Kellermann, Roubaix.</p>`;
const JOBS = `<h2>Technicien systèmes et réseaux</h2><p>Environnement VMware vSphere, sauvegardes Veeam, baie NetApp, Microsoft 365.</p>`;

describe("extraction des coordonnées", () => {
  it("emails, y compris « [at] », sans images ni exemples", () => {
    const e = extractEmails(`${HOME} <img src="logo@2x.png"> ecrivez à votre@email.com <a href="mailto:Ventes@Atelier-Durand.fr">`);
    expect(e).toContain("contact@atelier-durand.fr");
    expect(e).toContain("ventes@atelier-durand.fr");
    expect(e.some((x) => x.includes("png") || x.startsWith("votre@"))).toBe(false);
  });

  it("téléphones français normalisés, hors SIRET", () => {
    expect(formatPhone("+33 (0)2 40 11 22 33")).toBe("02 40 11 22 33");
    expect(extractPhones(`${HOME} SIRET 0240112233 · Fax : 02.40.99.88.77`)).toEqual(["02 40 11 22 33", "02 40 99 88 77"]);
  });

  it("LinkedIn société, sans lien de partage", () => {
    expect(extractSocials(HOME)).toEqual({ linkedin: "https://www.linkedin.com/company/atelier-durand" });
  });

  it("liens internes utiles uniquement", () => {
    const l = pickInternalLinks(HOME, "https://www.atelier-durand.fr/");
    expect(l.contact).toBe("https://www.atelier-durand.fr/contact");
    expect(l.mentions).toBe("https://www.atelier-durand.fr/mentions-legales");
    expect(l.careers).toBe("https://www.atelier-durand.fr/recrutement");
  });
});

describe("vérification du site", () => {
  it("SIREN espacé dans les mentions légales = vérifié", () => {
    expect(textHasSiren(htmlToText(MENTIONS), "732829320")).toBe(true);
    expect(siteMatch({ html: HOME, text: htmlToText(MENTIONS), siren: "732829320", name: "X" })).toBe("verifie");
  });
  it("à défaut, titre concordant = probable ; sinon rien", () => {
    expect(siteMatch({ html: HOME, text: "", siren: "552100554", name: "ATELIER DURAND" })).toBe("probable");
    expect(siteMatch({ html: HOME, text: "", siren: "552100554", name: "BOULANGERIE MARTIN" })).toBeNull();
  });
});

describe("outils et hébergeur", () => {
  it("repère virtualisation, sauvegarde, stockage", () => {
    const labels = detectTech(JOBS).map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(["VMware", "Veeam", "NetApp", "Microsoft 365"]));
    expect(detectTech("Nos valeurs : la confiance")).toEqual([]);
  });
  it("hébergeur des mentions légales", () => {
    expect(extractHoster(htmlToText(MENTIONS))).toBe("OVH");
  });
});

describe("emails des dirigeants", () => {
  it("motif observé à partir d'une adresse nominative", () => {
    expect(inferEmailPattern(["p.durand@atelier-durand.fr", "contact@atelier-durand.fr"], [{ name: "Paul Durand" }])).toBe("p.nom");
    expect(applyPattern("prenom.nom", "Jean-Marc LE GOFF", "x.fr")).toBe("jean.marclegoff@x.fr");
  });
  it("pas d'email deviné sans MX", () => {
    expect(guessLeaderEmails([{ name: "Paul Durand" }], [], "atelier-durand.fr", false)).toEqual([]);
  });
  it("adresse trouvée sur le site prioritaire, sinon motif", () => {
    const g = guessLeaderEmails([{ name: "Paul Durand", role: "Président" }, { name: "Marie Roux" }],
      ["p.durand@atelier-durand.fr"], "atelier-durand.fr", true);
    expect(g[0]).toMatchObject({ email: "p.durand@atelier-durand.fr", confidence: "trouvé sur le site" });
    expect(g[1]).toMatchObject({ email: "m.roux@atelier-durand.fr", confidence: "motif observé" });
  });
  it("adresses génériques reconnues", () => {
    expect(isGenericEmail("accueil@mairie.fr")).toBe(true);
    expect(isGenericEmail("p.durand@x.fr")).toBe(false);
  });
});

describe("robots.txt et domaines", () => {
  it("respecte Disallow / Allow", () => {
    const ok = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public");
    expect(ok("/contact")).toBe(true);
    expect(ok("/admin/x")).toBe(false);
    expect(ok("/admin/public/a")).toBe(true);
  });
  it("candidats de domaine sans forme juridique", () => {
    const c = domainCandidates("ATELIER DURAND SAS");
    expect(c).toEqual(expect.arrayContaining(["atelierdurand.fr", "atelier-durand.fr", "atelier-durand.com"]));
    expect(rootDomain("www.shop.exemple.co.uk")).toBe("exemple.co.uk");
  });
});

describe("exploration d'un site (réseau simulé)", () => {
  it("assemble accueil + mentions + contact + recrutement, en respectant robots.txt", async () => {
    const pages = {
      "https://www.atelier-durand.fr/": HOME,
      "https://www.atelier-durand.fr/robots.txt": "User-agent: *\nDisallow: /contact",
      "https://www.atelier-durand.fr/mentions-legales": MENTIONS,
      "https://www.atelier-durand.fr/recrutement": JOBS,
    };
    const asked = [];
    const http = { get: async (u) => { asked.push(u); return pages[u] ? { ok: true, status: 200, url: u, text: pages[u] } : { ok: false, status: 404, url: u, text: "" }; } };
    const site = await crawlSite("https://www.atelier-durand.fr/", { siren: "732829320", name: "Atelier Durand", http });
    expect(site.match).toBe("verifie");
    expect(site.hoster).toBe("OVH");
    expect(site.phones[0]).toBe("02 40 11 22 33");
    expect(site.emails).toContain("p.durand@atelier-durand.fr");
    expect(site.tech.map((t) => t.label)).toContain("Veeam");
    expect(asked).not.toContain("https://www.atelier-durand.fr/contact"); // interdit par robots.txt
  });
});

describe("DNS", () => {
  it("Microsoft 365 derrière une passerelle, services SaaS", () => {
    const d = classifyDns({
      mx: [{ exchange: "eu-smtp-inbound-1.mimecast.com" }],
      txt: [["v=spf1 include:spf.protection.outlook.com include:_spf.salesforce.com -all"], ["MS=ms12345678"], ["atlassian-domain-verification=abc"]],
    });
    expect(d.mail_provider).toBe("Microsoft 365");
    expect(d.mail_gateway).toBe("Mimecast");
    expect(d.services).toEqual(expect.arrayContaining(["Microsoft 365", "Salesforce", "Atlassian (Jira / Confluence)"]));
  });
  it("Google Workspace direct", () => {
    expect(classifyDns({ mx: [{ exchange: "aspmx.l.google.com" }] }).mail_provider).toBe("Google Workspace");
  });
});

describe("marchés publics (BOAMP)", () => {
  it("acheteur public détecté par NAF ou catégorie juridique", () => {
    expect(isPublicBuyer({ naf: "84.11Z" })).toBe(true);
    expect(isPublicBuyer({ naf: "62.01Z", nature_juridique: "5710" })).toBe(false);
  });
  it("garde les avis informatiques de cet acheteur", () => {
    const n = normalizeNotices([
      { idweb: "25-1", objet: "Fourniture de serveurs et stockage", nomacheteur: "Communauté de communes du Pays de Retz", dateparution: "2025-03-01", datelimitereponse: "2099-01-01" },
      { idweb: "25-2", objet: "Travaux de voirie", nomacheteur: "Communauté de communes du Pays de Retz", dateparution: "2025-02-01" },
      { idweb: "25-3", objet: "Maintenance informatique", nomacheteur: "Ville de Nantes", dateparution: "2025-01-01" },
    ], "COMMUNAUTE DE COMMUNES DU PAYS DE RETZ");
    expect(n.map((x) => x.id)).toEqual(["25-1"]);
    expect(n[0].ouvert).toBe(true);
  });
});

import { acceptGuess } from "@/lib/account-intel";

describe("site deviné : garde-fous", () => {
  it("SIREN trouvé = accepté", () => {
    expect(acceptGuess({ match: "verifie", host: "x.fr" }, "Quoi que ce soit")).toBe(true);
  });
  it("nom court ou générique refusé sans SIREN", () => {
    expect(acceptGuess({ match: "probable", host: "123.fr" }, "123")).toBe(false);
    expect(acceptGuess({ match: "probable", host: "missionlocale.fr" }, "MISSION LOCALE DU LUBERON")).toBe(false);
  });
  it("nom distinctif identique au domaine = accepté", () => {
    expect(acceptGuess({ match: "probable", host: "sofrica.com" }, "Sofrica")).toBe(true);
  });
});
