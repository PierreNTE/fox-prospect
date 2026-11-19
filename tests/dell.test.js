import { describe, it, expect } from "vitest";
import { parseLeadPages, dedupeByCompany, cleanCompanyName, usDateToIso } from "@/lib/salesforce-leads";
import { nameScore, pickBestMatch, classifyBodacc, healthVerdict } from "@/lib/company-health";
import { qualifProgress, salesforceSummary, monthsUntil, sanitizeQualif } from "@/lib/dell-qualif";

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

describe("qualification Dell", () => {
  const now = new Date("2026-11-19");
  const q = {
    servers: { count: "12", brand: "HPE", model: "DL380 Gen10", hypervisor: "VMware vSphere 7", eos: "2027-03" },
    storage: { brand: "NetApp", model: "FAS2750", capacity: "40 To", eos: "2026-09" },
    bant: { budget: "150 k€ voté au BP 2027", authority: "DSI + DAF", need: "Sortir de VMware", consultation: "2027-01", deadline: "2027-06" },
    call: { interlocutor: "Claire Martin", role: "DSI", next_step: "RDV AE le 02/12" },
  };

  it("détecte l'opportunité et le BANT complet", () => {
    const p = qualifProgress(q, now);
    expect(p.opportunity).toBe(true);
    expect(p.nextStep).toBe(true);
  });

  it("n'appelle pas opportunité une fiche sans fin de maintenance", () => {
    const p = qualifProgress({ servers: { count: "5", brand: "Dell", hypervisor: "Hyper-V" } }, now);
    expect(p.opportunity).toBe(false);
  });

  it("repère les fins de maintenance dans les 12 mois, échues comprises", () => {
    const p = qualifProgress(q, now);
    expect(p.renewalSoon.map((e) => e.block)).toEqual(["storage", "servers"]);
    expect(monthsUntil("2027-03", now)).toBe(4);
  });

  it("produit un résumé Salesforce lisible", () => {
    const txt = salesforceSummary(q, { accountName: "ACME", date: now });
    expect(txt).toContain("QUALIF INFRA — ACME — 19/11/2026");
    expect(txt).toContain("SERVEURS : 12 serveur(s) · HPE · DL380 Gen10 · hyperviseur VMware vSphere 7 · fin de maintenance 03/2027");
    expect(txt).toContain("STOCKAGE : NetApp · FAS2750 · 40 To · fin de maintenance 09/2026");
    expect(txt).toContain("BACKUP : non qualifié");
    expect(txt).toContain("- Timeline : consultation 01/2027 · mise en place 06/2027");
    expect(txt).toContain("NEXT STEP : RDV AE le 02/12");
  });

  it("nettoie la fiche reçue du client", () => {
    expect(sanitizeQualif({ servers: { count: "3", hack: "x" }, evil: { a: 1 } })).toEqual({ servers: { count: "3" } });
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
