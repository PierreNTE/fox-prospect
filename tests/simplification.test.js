import { describe, it, expect } from "vitest";
import { analyzeDuplicates, duplicateFlags, pickKeeper } from "@/lib/account-merge";
import { scrapeRowsToContacts, splitFullName } from "@/lib/leads-pipeline";

const L = (id, name, extra = {}) => ({ id, name, sf_lead_status: "New", created_at: `2026-11-0${id.length}`, health_detail: {}, ...extra });

describe("doublons et groupes", () => {
  it("même SIREN = doublon sûr, on garde le statut le plus vivant", () => {
    const a = L("a", "ALPHA SAS", { sf_lead_status: "Working", health_detail: { siren: "111" } });
    const b = L("b", "ALPHA (ENSEIGNE)", { sf_lead_status: "New", health_detail: { siren: "111" } });
    const { sure } = analyzeDuplicates([a, b]);
    expect(sure.map(([k, d]) => [k.id, d.id])).toEqual([["b", "a"]]);
    expect(pickKeeper(a, b)[0].id).toBe("b");
  });
  it("société reprise par un autre lead = doublon sûr", () => {
    const old = L("o", "ANCIENNE", { health_detail: { siren: "222", successor: { siren: "333", confidence: "forte" } } });
    const neu = L("n", "NOUVELLE", { health_detail: { siren: "333" } });
    expect(analyzeDuplicates([old, neu]).sure.map(([k, d, r]) => [k.id, d.id, r])).toEqual([["n", "o", "repris par l'autre compte"]]);
  });
  it("noms quasi identiques = doublon possible (alerte seulement)", () => {
    const f = duplicateFlags([L("x", "Bêta Industrie", { health_detail: { siren: "1" } }), L("y", "BETA INDUSTRIE SAS", { health_detail: { siren: "2" } }), L("z", "Gamma")]);
    expect(f.get("x")[0]).toMatchObject({ kind: "doublon", other_id: "y" });
    expect(f.get("z")).toBeUndefined();
  });
  it("même holding présidente = même groupe ; mère dans la liste = filiale", () => {
    const g = { siren: "900", name: "HOLDING DELTA" };
    const leads = [
      L("f1", "DELTA OUEST", { health_detail: { siren: "901", groupe: g } }),
      L("f2", "DELTA EST", { health_detail: { siren: "902", groupe: g } }),
      L("m", "HOLDING DELTA", { health_detail: { siren: "900" } }),
    ];
    const f = duplicateFlags(leads);
    expect(f.get("f1").map((x) => x.kind).sort()).toEqual(["filiale", "groupe"]);
    expect(f.get("f1").find((x) => x.kind === "groupe").others).toEqual(["DELTA EST"]);
    expect(f.get("f2").find((x) => x.kind === "filiale").other_name).toBe("HOLDING DELTA");
  });
});

describe("décideurs du worker → contacts", () => {
  it("découpe le nom, dédoublonne, garde LinkedIn et email", () => {
    expect(splitFullName("Jean-Marc de La Tour")).toEqual({ first: "Jean-Marc de La", last: "Tour" });
    const rows = scrapeRowsToContacts([
      { account_id: "a", full_name: "Paul Durand", title: "Responsable informatique", linkedin_url: "https://linkedin.com/in/p", email: "p.durand@x.fr", email_confidence: "basse", email_source: "motif" },
      { account_id: "a", full_name: "Paul Durand", title: "Doublon" },
      { account_id: "a", full_name: "Marie Roux", title: "DAF" },
      { account_id: "b", full_name: "Seul" },
    ], { a: ["marie roux"] }, "2026-11");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ account_id: "a", first_name: "Paul", last_name: "Durand", role: "Responsable informatique", email: "p.durand@x.fr", reliability: "partiel" });
  });
});

import { recallDue, isFinalStatus, CALL_STATUS_META } from "@/lib/call-status";
import { buildFreeCallPrep } from "@/lib/call-prep-free";

describe("suivi d'appel", () => {
  it("rappel dû le jour même ou en retard, pas avant", () => {
    expect(recallDue("2026-11-23", "2026-11-23")).toBe(true);
    expect(recallDue("2026-11-20", "2026-11-23")).toBe(true);
    expect(recallDue("2026-11-24", "2026-11-23")).toBe(false);
    expect(recallDue(null, "2026-11-23")).toBe(false);
  });
  it("RDV et pas intéressé sortent de la liste à appeler", () => {
    expect(isFinalStatus("rdv")).toBe(true);
    expect(isFinalStatus("pas_interesse")).toBe(true);
    expect(isFinalStatus("rappeler")).toBe(false);
    expect(CALL_STATUS_META.rappeler.label).toBe("À rappeler");
  });
  it("la signature reprend le poste saisi dans les réglages", () => {
    const p = buildFreeCallPrep({ account: { id: "z", name: "GAMMA SAS", health_detail: {} }, sender: { sender_name: "Alex Martin", sender_role: "Account Executive" } });
    expect(JSON.stringify(p)).toContain("Alex Martin\\nAccount Executive\\nDell Technologies");
  });
});
