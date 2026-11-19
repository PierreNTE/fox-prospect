import { describe, it, expect } from "vitest";
import { parseLeadPages, dedupeByCompany, cleanCompanyName, usDateToIso } from "@/lib/salesforce-leads";
import { nameScore, pickBestMatch, classifyBodacc, healthVerdict } from "@/lib/company-health";

// Fixture synthétique reproduisant la géométrie de l'export « Printable View »
// Salesforce (positions mesurées sur un export réel ; noms inventés).
const HEADER = [
  ["Name", 44], ["Lead Status", 82.5], ["Lead Type", 127.6], ["Account", 157.9],
  ["Buyer Lever", 252.1], ["Account Owner", 289.7], ["Company", 343.5],
  ["Created Date", 437.7], ["Campaign Short Name", 475], ["Campaign", 536.9],
].map(([str, x]) => ({ str, x, y: 78 }));

function row(y, { status, company, created, campaign = ["SB France", "Associates"], name = ["Outbound", "Lead"] }) {
  return [
    { str: name[0], x: 43.5, y: y - 3.5 }, { str: name[1], x: 43.5, y: y + 3.5 },
    ...(status.length === 2
      ? [{ str: status[0], x: 82, y: y - 3.5 }, { str: status[1], x: 82, y: y + 3.5 }]
      : [{ str: status[0], x: 82, y }]),
    { str: "Outbound", x: 127.1, y },
    { str: company, x: 157.4, y },
    { str: "Jean Collaborateur", x: 289.2, y },
    { str: company, x: 343, y },
    { str: created, x: 437.2, y },
    { str: campaign[0], x: 474.5, y: y - 3.5 }, { str: campaign[1], x: 474.5, y: y + 3.5 },
    { str: "FY27-NGSA_SB F", x: 536.4, y },
  ];
}

const PAGES = [
  {
    height: 792,
    items: [
      { str: "Number of records", x: 492, y: 40 }, { str: "1000", x: 550, y: 40 },
      ...HEADER,
      ...row(92.5, { status: ["New"], company: "ACME PLASTIQUES (Oyonnax)", created: "10/07/2026" }),
      ...row(111, { status: ["Working"], company: "BETA SANTE", created: "07/10/2026" }),
      { str: "10/14/26, 4:07 PM", x: 24, y: 22.5 },
      { str: "1/28", x: 568, y: 775.5 },
    ],
  },
  {
    height: 792,
    items: [
      ...row(40, { status: ["Closed by", "Sales"], company: "BETA SANTE", created: "02/07/2026", name: ["Martin,", "Paul"] }),
      ...row(58, { status: ["New"], company: "GAMMA [GHT]", created: "03/08/2026" }),
    ],
  },
];

describe("parseLeadPages — export PDF Salesforce", () => {
  const { rows, total } = parseLeadPages(PAGES);

  it("reconstruit une ligne par lead, y compris sur les pages sans en-tête", () => {
    expect(total).toBe(1000);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.company)).toEqual(["ACME PLASTIQUES (Oyonnax)", "BETA SANTE", "BETA SANTE", "GAMMA [GHT]"]);
  });

  it("recolle les cellules sur deux lignes", () => {
    expect(rows[0].campaign).toBe("SB France Associates");
    expect(rows[2].status).toBe("Closed by Sales");
    expect(rows[2].contact).toBe("Martin, Paul");
  });

  it("lit les dates au format US de Salesforce", () => {
    expect(rows[0].created).toBe("2026-10-07");
    expect(usDateToIso("07/10/2026")).toBe("2026-07-10");
  });

  it("ne conserve aucun nom de collaborateur Dell", () => {
    expect(JSON.stringify(rows)).not.toContain("Jean Collaborateur");
  });

  it("déduplique par société en gardant le statut le plus ouvert", () => {
    const d = dedupeByCompany(rows);
    expect(d).toHaveLength(3);
    expect(d.find((r) => r.company === "BETA SANTE")).toMatchObject({ status: "Working", leads: 2, contacts: 1 });
  });
});

describe("cleanCompanyName", () => {
  it("sépare l'indice de localisation", () => {
    expect(cleanCompanyName("MBF PLASTIQUES (Oyonnax)")).toEqual({ query: "MBF PLASTIQUES", hint: "Oyonnax" });
    expect(cleanCompanyName("Commune Buxy (71)")).toEqual({ query: "Commune Buxy", hint: "71" });
    expect(cleanCompanyName("AUTOROUTE ESTEREL A[DMU]").query).toBe("AUTOROUTE ESTEREL A");
  });
});

describe("rapprochement SIRENE", () => {
  it("ignore formes juridiques et accents", () => {
    expect(nameScore("SELARL Imagerie Médicale du Parc", "IMAGERIE MEDICALE DU PARC")).toBe(1);
    expect(nameScore("DATAFILIATION", "DATA FILIATION")).toBe(1);
    expect(nameScore("MBF PLASTIQUES", "MBF PLASTIQUE")).toBe(1);
  });

  it("préfère l'établissement de la commune indiquée", () => {
    const results = [
      { siren: "111111111", nom_complet: "MBF PLASTIQUES", etat_administratif: "A", siege: { libelle_commune: "LYON" } },
      { siren: "222222222", nom_complet: "MBF PLASTIQUES", etat_administratif: "A", siege: { libelle_commune: "OYONNAX" } },
    ];
    const m = pickBestMatch("MBF PLASTIQUES", "Oyonnax", results);
    expect(m.result.siren).toBe("222222222");
    expect(m.confidence).toBe("sure");
  });

  it("ne retient pas un homonyme de dirigeant (cas réel : MBF PLASTIQUES)", () => {
    // L'API remonte en tête une société fermée dont MBF est administrateur.
    const results = [
      { siren: "656950110", nom_complet: "LE TRAIT D UNION INDUSTRIEL & COMMERCIAL", etat_administratif: "C", siege: { libelle_commune: "OYONNAX" } },
      { siren: "333333333", nom_complet: "MBF PLASTIQUE", etat_administratif: "A", siege: { libelle_commune: "OYONNAX" } },
    ];
    expect(pickBestMatch("MBF PLASTIQUES", "Oyonnax", results).result.siren).toBe("333333333");
  });

  it("signale un rapprochement faible", () => {
    const m = pickBestMatch("NEGOMETAL", "", [{ siren: "1", nom_complet: "BOULANGERIE DUPONT", siege: {} }]);
    expect(m.confidence).toBe("faible");
  });
});

describe("classifyBodacc", () => {
  const now = new Date("2026-11-19");
  const coll = (dateparution, nature) => ({
    familleavis: "collective", dateparution, jugement: JSON.stringify({ nature, date: dateparution }),
  });

  it("détecte une liquidation en cours", () => {
    const r = classifyBodacc([coll("2026-09-24", "Jugement d'ouverture de liquidation judiciaire")], now);
    expect(r.procedure).toBe("liquidation");
  });

  it("retient la dernière annonce (conversion redressement → liquidation)", () => {
    const r = classifyBodacc([
      coll("2026-03-01", "Jugement d'ouverture d'une procédure de redressement judiciaire"),
      coll("2026-06-01", "Jugement de conversion en liquidation judiciaire"),
    ], now);
    expect(r.procedure).toBe("liquidation");
  });

  it("oublie un plan de continuation ancien", () => {
    const r = classifyBodacc([coll("2019-05-01", "Jugement arrêtant le plan de redressement")], now);
    expect(r.procedure).toBeNull();
  });

  it("ignore les annonces hors procédures collectives", () => {
    expect(classifyBodacc([{ familleavis: "dpc", dateparution: "2026-01-01" }], now).procedure).toBeNull();
  });

  it("verdict : fermée > liquidation > vigilance > active", () => {
    const match = { confidence: "sure" };
    expect(healthVerdict({ match, etat: "C" }).status).toBe("fermee");
    expect(healthVerdict({ match, etat: "A", bodacc: { procedure: "liquidation", label: "x" } }).status).toBe("fermee");
    expect(healthVerdict({ match, etat: "A", bodacc: { procedure: "redressement", label: "x" } }).status).toBe("vigilance");
    expect(healthVerdict({ match, etat: "A", bodacc: { procedure: null } }).status).toBe("active");
    expect(healthVerdict({}).status).toBe("introuvable");
  });
});

import { vi, afterEach } from "vitest";
import { checkCompanyHealth } from "@/lib/company-health";

describe("checkCompanyHealth — enchaînement SIRENE → BODACC (fetch simulé)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classe en vigilance une société active en redressement", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url) => {
      calls.push(String(url));
      const body = String(url).includes("recherche-entreprises")
        ? { results: [{ siren: "123456789", nom_complet: "NEGOMETAL", etat_administratif: "A", siege: { libelle_commune: "LYON" } }] }
        : { results: [{ familleavis: "collective", dateparution: "2026-10-01", registre: ["123 456 789", "123456789"],
            jugement: JSON.stringify({ nature: "Jugement d'ouverture d'une procédure de redressement judiciaire" }) }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const r = await checkCompanyHealth({ query: "NEGOMETAL", hint: "" });
    expect(r.match.siren).toBe("123456789");
    expect(r.verdict.status).toBe("vigilance");
    expect(calls[1]).toContain("registre");
  });

  it("reste exploitable si le BODACC ne répond pas", async () => {
    vi.stubGlobal("fetch", async (url) =>
      String(url).includes("recherche-entreprises")
        ? new Response(JSON.stringify({ results: [{ siren: "123456789", nom_complet: "NEGOMETAL", etat_administratif: "A", siege: {} }] }))
        : new Response("down", { status: 503 })
    );
    const r = await checkCompanyHealth({ query: "NEGOMETAL", hint: "" });
    expect(r.verdict.status).toBe("active");
    expect(r.verdict.label).toMatch(/BODACC non consulté/);
  });
});

import { parsePastedCompanies } from "@/lib/salesforce-leads";

describe("parseLeadPages — variantes d'export", () => {
  const mk = (labels, rows) => [{
    height: 792,
    items: [
      ...labels.map(([str, x]) => ({ str, x, y: 78 })),
      ...rows.flatMap(([company, date, status], i) => [
        { str: status, x: 82, y: 92 + i * 18 },
        { str: company, x: 343, y: 92 + i * 18 },
        { str: date, x: 437.2, y: 92 + i * 18 },
      ]),
    ],
  }];

  it("lit un export Salesforce en français", () => {
    const { rows } = parseLeadPages(mk(
      [["Nom", 44], ["Statut du lead", 82.5], ["Société", 343.5], ["Date de création", 437.7]],
      [["ACME", "14/10/2026", "Nouveau"], ["BETA", "15/10/2026", "En cours"]]
    ));
    expect(rows.map((r) => r.company)).toEqual(["ACME", "BETA"]);
    expect(rows[1].status).toBe("En cours");
  });

  it("recolle un intitulé découpé en morceaux (« Created » + « Date »)", () => {
    const { rows } = parseLeadPages(mk(
      [["Lead Status", 82.5], ["Company", 343.5], ["Created", 437.7, 22], ["Date", 459]],
      [["ACME", "10/14/2026", "New"]]
    ).map((p) => ({ ...p, items: p.items.map((i) => (i.str === "Created" ? { ...i, w: 20 } : i)) })));
    expect(rows).toHaveLength(1);
  });

  it("ne prend pas une ligne « Société Générale » pour un en-tête", () => {
    const pages = mk([["Lead Status", 82.5], ["Company", 343.5], ["Created Date", 437.7]], [["ACME", "10/14/2026", "New"]]);
    pages.push({ height: 792, items: [
      { str: "Working", x: 82, y: 40 }, { str: "Société Générale", x: 343, y: 40 }, { str: "10/15/2026", x: 437.2, y: 40 },
    ] });
    const { rows } = parseLeadPages(pages);
    expect(rows.map((r) => r.company)).toEqual(["ACME", "Société Générale"]);
  });

  it("explique un échec (diagnostic)", () => {
    const { rows, diagnostic } = parseLeadPages([{ height: 792, items: [{ str: "Bonjour", x: 10, y: 10 }] }]);
    expect(rows).toHaveLength(0);
    expect(diagnostic).toMatchObject({ pages: 1, headerFound: false, sample: ["Bonjour"] });
  });
});

describe("parsePastedCompanies", () => {
  it("une société par ligne, dédoublonnée, en-tête et colonnes ignorés", () => {
    const r = parsePastedCompanies("Company\tStatus\nACME\tNew\nacme\nBETA SANTE;Working\n\n");
    expect(r.map((x) => x.company)).toEqual(["ACME", "BETA SANTE"]);
  });

  it("prend la colonne Company d'un tableau copié depuis Salesforce", () => {
    const txt = "Name\tLead Status\tAccount\tCompany\tCreated Date\nOutbound Lead\tWorking\tACME GROUP\tACME (Lyon)\t07/10/2026\nOutbound Lead\tNew\tBETA\tBETA SANTE\t07/10/2026";
    const r = parsePastedCompanies(txt);
    expect(r.map((x) => [x.company, x.status])).toEqual([["ACME (Lyon)", "Working"], ["BETA SANTE", "New"]]);
  });
});

import { ocrWordsToItems } from "@/lib/salesforce-leads";

describe("ocrWordsToItems — PDF sans texte relu par OCR", () => {
  const S = 300 / 72;
  const w = (text, x, y, width = text.length * 5) => ({
    text, bbox: { x0: x * S, y0: (y - 6) * S, x1: (x + width) * S, y1: y * S },
  });

  it("recolle les mots d'une cellule mais pas deux colonnes voisines", () => {
    const items = ocrWordsToItems([
      w("Created", 437.7, 78, 22), w("Date", 461, 78, 13), w("Campaign", 500, 78, 26),
      w("CAFE", 343, 92, 15), w("DE", 359.5, 92.6, 7), w("PARIS", 368, 92, 18),
    ], S);
    expect(items.map((i) => i.str)).toEqual(["Created Date", "Campaign", "CAFE DE PARIS"]);
    expect(items[0].x).toBeCloseTo(437.7, 1);
  });

  it("alimente parseLeadPages comme un vrai PDF", () => {
    const words = [
      w("Lead", 82.5, 78, 13), w("Status", 97, 78, 18), w("Company", 343.5, 78, 25), w("Created", 437.7, 78, 22), w("Date", 461, 78, 13),
      w("Working", 82, 92.5, 24), w("ACME", 343, 92.5, 18), w("SANTE", 363, 92.5, 21), w("05/11/2026", 437.2, 92.5, 30),
    ];
    const { rows } = parseLeadPages([{ height: 792, items: ocrWordsToItems(words, S) }]);
    expect(rows).toEqual([expect.objectContaining({ company: "ACME SANTE", status: "Working" })]);
  });
});

import { normalizeCallPrep, contactsToInsert, explainAiError } from "@/lib/prompts-call-prep";
import { normalizeSireneResult } from "@/lib/sirene";

describe("fiche d'approche", () => {
  const raw = {
    identite: "PME industrielle",
    coordonnees: { site: "www.acme.fr", standard: "04 74 00 00 00", email_generique: "contact@acme.fr", format_email: "null" },
    contacts: [
      { prenom: "Claire", nom: "Martin", poste: "DSI", linkedin_url: "https://www.linkedin.com/in/claire", confiance: "haute" },
      { prenom: "", nom: "", poste: "Responsable infra" },
      { prenom: "Paul", nom: "Durand", poste: "DAF", linkedin_url: "linkedin.com/in/paul", confiance: "inventée" },
    ],
    messages: { email: { objet: "Votre parc serveurs", corps: "Bonjour…" }, linkedin_invitation: "x".repeat(400) },
  };
  const prep = normalizeCallPrep(raw);

  it("nettoie la réponse du modèle (URL, null textuels, contacts vides)", () => {
    expect(prep.coordonnees.site).toBeNull(); // pas d'URL absolue → rejeté
    expect(prep.coordonnees.format_email).toBeNull();
    expect(prep.contacts.map((c) => c.nom)).toEqual(["Martin", "Durand"]);
    expect(prep.contacts[1]).toMatchObject({ linkedin_url: null, confiance: "basse" });
    expect(prep.messages.linkedin_invitation.length).toBe(300);
  });

  it("ajoute les interlocuteurs à l'organigramme sans doublon", () => {
    const rows = contactsToInsert(prep, [{ first_name: "claire", last_name: "MARTIN" }], "acc-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ account_id: "acc-1", first_name: "Paul", last_name: "Durand", role: "DAF", role_confidence: "incertain" });
  });

  it("traduit les erreurs de l'API Anthropic", () => {
    expect(explainAiError('Anthropic API 400: {"error":{"message":"Your credit balance is too low"}}')).toMatch(/Crédit Anthropic épuisé/);
    expect(explainAiError("Anthropic API 401: invalid x-api-key")).toMatch(/Clé API/);
    expect(explainAiError("autre chose")).toBe("autre chose");
  });
});

describe("normalizeSireneResult", () => {
  it("ramène le code NAF à 5 caractères (colonne char(5))", () => {
    expect(normalizeSireneResult({ siren: "1", activite_principale: "62.01Z", siege: {} }).naf_code).toBe("6201Z");
  });
});
