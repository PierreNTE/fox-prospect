import { describe, it, expect } from "vitest";
import {
  isValidSiren, extractSirens, recordText, successorCandidates, activeHomonyms, findSuccessor,
} from "@/lib/company-successor";
import { applySuccessor } from "@/lib/company-health";

// SIREN à clé de Luhn valide (utilisés comme simples identifiants de test).
const OLD = "732829320";
const NEW = "552100554";
const OTHER = "542065479";

describe("SIREN cités dans les annonces", () => {
  it("valide la clé de Luhn", () => {
    expect(isValidSiren(OLD)).toBe(true);
    expect(isValidSiren(NEW)).toBe(true);
    expect(isValidSiren("123456789")).toBe(false);
  });

  it("extrait les SIREN espacés et ignore les montants", () => {
    const t = `Société absorbante NOUVELLE SAS, 552 100 554 RCS Paris, au capital de 542 065 479 euros`;
    expect(extractSirens(t)).toEqual([NEW]);
  });

  it("lit les champs JSON imbriqués des annonces", () => {
    const rec = { dateparution: "2025-03-01", radiationaurcs: JSON.stringify({ commentaire: "Radiation suite à fusion" }) };
    expect(recordText(rec)).toMatch(/Radiation suite à fusion/);
  });
});

describe("pistes de successeur", () => {
  it("fusion-absorption annoncée dans la radiation de la société fermée", () => {
    const own = [{
      dateparution: "2025-06-12", registre: [OLD],
      radiationaurcs: JSON.stringify({ commentaire: `Radiation du RCS suite à fusion-absorption par la société NOUVELLE SAS (${NEW.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")} RCS Nantes)` }),
    }];
    const c = successorCandidates(own, [], { ownSiren: OLD, oldName: "ANCIENNE SARL" });
    expect(c[0]).toMatchObject({ siren: NEW, reason: "fusion" });
  });

  it("changement de dénomination publié par la société sous son nouveau nom", () => {
    const byName = [{
      dateparution: "2024-11-02", registre: [NEW, "552 100 554"],
      modificationsgenerales: JSON.stringify({ descriptif: "Modification de la dénomination. Ancienne dénomination : DUPONT INFORMATIQUE" }),
    }];
    const c = successorCandidates([], byName, { ownSiren: null, oldName: "Dupont Informatique" });
    expect(c[0]).toMatchObject({ siren: NEW, reason: "rename" });
  });

  it("ignore les annonces qui citent un autre nom ou sans mot de liaison", () => {
    const byName = [
      { dateparution: "2024-01-01", registre: [NEW], modificationsgenerales: JSON.stringify({ descriptif: "Ancienne dénomination : AUTRE CHOSE" }) },
      { dateparution: "2024-01-01", registre: [OTHER], commercant: "DUPONT INFORMATIQUE", depot: "Dépôt des comptes" },
    ];
    expect(successorCandidates([], byName, { oldName: "Dupont Informatique" })).toEqual([]);
  });

  it("dans ses propres annonces, le précédent propriétaire n'est pas un successeur", () => {
    const own = [{ dateparution: "2015-01-01", registre: [OLD], acte: JSON.stringify({ descriptif: `Achat du fonds. Précédent propriétaire : X ${OTHER}` }) }];
    expect(successorCandidates(own, [], { ownSiren: OLD, oldName: "ANCIENNE" })).toEqual([]);
  });

  it("homonyme actif = simple piste", () => {
    const results = [
      { siren: OLD, nom_complet: "DUPONT INFORMATIQUE", etat_administratif: "C" },
      { siren: NEW, nom_complet: "DUPONT INFORMATIQUE", etat_administratif: "A" },
    ];
    expect(activeHomonyms("Dupont Informatique", results, OLD).map((r) => r.siren)).toEqual([NEW]);
  });
});

describe("recherche complète et verdict", () => {
  const net = (over = {}) => ({
    fetchRecords: async () => [{
      dateparution: "2025-06-12", registre: [OLD],
      radiationaurcs: JSON.stringify({ commentaire: `Radiation suite à fusion-absorption par NOUVELLE SAS ${NEW}` }),
    }],
    searchText: async () => [],
    lookupSiren: async (s) => (s === NEW ? { siren: NEW, nom_complet: "NOUVELLE SAS", etat_administratif: "A" } : null),
    classify: async () => ({ procedure: null, label: "", date: null, nature: "" }),
    ...over,
  });

  it("trouve l'absorbante active et rend le compte appelable sous son nom", async () => {
    const closed = { siren: OLD, nom_complet: "ANCIENNE SARL", etat_administratif: "C" };
    const succ = await findSuccessor({ query: "Ancienne", closed, results: [closed] }, net());
    expect(succ).toMatchObject({ siren: NEW, confidence: "forte", reason: "fusion" });

    const check = {
      match: { siren: OLD, score: 1, confidence: "sure" }, sirene: closed, bodacc: null,
      verdict: { status: "fermee", label: "Société fermée (cessée au répertoire SIRENE)" },
    };
    const out = applySuccessor(check, succ);
    expect(out.verdict.status).toBe("active");
    expect(out.verdict.label).toMatch(/Continue sous « NOUVELLE SAS »/);
    expect(out.match.siren).toBe(NEW);
    expect(out.predecessor).toMatchObject({ siren: OLD, name: "ANCIENNE SARL" });
  });

  it("successeur lui-même fermé : on garde le verdict fermé", async () => {
    const closed = { siren: OLD, nom_complet: "ANCIENNE SARL", etat_administratif: "C" };
    const succ = await findSuccessor({ query: "Ancienne", closed, results: [closed] },
      net({ lookupSiren: async () => ({ siren: NEW, nom_complet: "NOUVELLE SAS", etat_administratif: "C" }) }));
    expect(succ).toBeNull();
  });

  it("piste faible : le verdict reste « fermée » avec la piste en clair", () => {
    const check = { match: { siren: OLD }, sirene: { nom_complet: "X" }, verdict: { status: "fermee", label: "Société fermée" } };
    const out = applySuccessor(check, { siren: NEW, name: "X BIS", reason: "homonyme", reason_label: "société active au nom proche", confidence: "a_verifier" });
    expect(out.verdict.status).toBe("fermee");
    expect(out.verdict.label).toMatch(/Piste : « X BIS »/);
    expect(out.successor.confidence).toBe("a_verifier");
  });

  it("panne réseau : aucune piste, pas d'erreur", async () => {
    const boom = async () => { throw new Error("HTTP 503"); };
    const succ = await findSuccessor({ query: "Ancienne", closed: { siren: OLD }, results: [] },
      { fetchRecords: boom, searchText: boom, lookupSiren: boom, classify: boom });
    expect(succ).toBeNull();
  });
});

describe("nom cité d'un bloc", () => {
  it("refuse les mots épars", () => {
    const byName = [{
      dateparution: "2024-01-01", registre: [NEW],
      modificationsgenerales: JSON.stringify({ descriptif: "Ancienne dénomination : INFORMATIQUE DU LAC. Gérant : M. Dupont" }),
    }];
    expect(successorCandidates([], byName, { oldName: "Dupont Informatique" })).toEqual([]);
  });
});

import { successorNames } from "@/lib/company-successor";

describe("successeur cité par son nom", () => {
  it("extrait le nom de l'absorbante sans SIREN", () => {
    const own = [{ dateparution: "2025-04-01", radiationaurcs: JSON.stringify({ commentaire: "Radiation du RCS suite à fusion-absorption par la société NOUVELLE INFORMATIQUE SAS, RCS Lyon" }) }];
    expect(successorNames(own)[0]).toMatchObject({ name: "NOUVELLE INFORMATIQUE SAS", reason: "fusion" });
  });
  it("cessionnaire d'un plan de cession", () => {
    const own = [{ dateparution: "2024-02-01", jugement: JSON.stringify({ nature: "Jugement arrêtant le plan de cession", complementJugement: "au profit de la société REPRISE OUEST, dont le siège" }) }];
    expect(successorNames(own)[0]?.name).toBe("REPRISE OUEST");
  });
  it("trouve l'absorbante active au SIRENE", async () => {
    const own = [{ dateparution: "2025-04-01", registre: [OLD], radiationaurcs: JSON.stringify({ commentaire: "Radiation suite à fusion-absorption par la société NOUVELLE SAS." }) }];
    const net = {
      fetchRecords: async () => own, searchText: async () => [], lookupSiren: async () => null,
      searchName: async () => [{ siren: NEW, nom_complet: "NOUVELLE SAS", etat_administratif: "A" }],
      classify: async () => null,
    };
    const s = await findSuccessor({ query: "Ancienne", closed: { siren: OLD }, results: [] }, net);
    expect(s).toMatchObject({ siren: NEW, confidence: "forte", reason: "fusion" });
  });
});
