import { describe, it, expect } from "vitest";
import { computeNba } from "@/lib/nba";

const base = { first_name: "Test", last_name: "User", company: "ACME" };

describe("computeNba — garde-fous", () => {
  it("opposition RGPD prime sur tout", () => {
    const nba = computeNba({ prospect: { ...base, do_not_contact: true, status: "interesse" } });
    expect(nba.action).toBe("opt_out");
    expect(nba.priority).toBe(0);
  });

  it("statuts terminaux", () => {
    expect(computeNba({ prospect: { ...base, status: "refuse" } }).action).toBe("archive");
    expect(computeNba({ prospect: { ...base, status: "client" } }).action).toBe("fideliser");
  });
});

describe("computeNba — relances planifiées", () => {
  it("relance en retard = priorité maximale", () => {
    const nba = computeNba({ prospect: { ...base, status: "contacte", follow_up_at: "2020-01-01" } });
    expect(nba.action).toBe("relance_prevue");
    expect(nba.priority).toBe(96);
  });

  it("relance future n'interfère pas", () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const nba = computeNba({ prospect: { ...base, status: "contacte", follow_up_at: future } });
    expect(nba.action).not.toBe("relance_prevue");
  });
});

describe("computeNba — funnel", () => {
  it("intéressé → préparer le RDV", () => {
    expect(computeNba({ prospect: { ...base, status: "interesse" } }).action).toBe("prepare_rdv");
  });

  it("contacté + signal urgent → relance urgente (signaux company_signals fusionnés)", () => {
    const nba = computeNba({
      prospect: { ...base, status: "contacte" },
      research: { signals: [{ type: "rfp_it", detail: "AO cyber" }] },
    });
    expect(nba.action).toBe("relance_urgente");
  });

  it("non contacté sans recherche → rechercher, priorisé par score", () => {
    const high = computeNba({ prospect: { ...base, status: "non_contacte", fit_score: 85 } });
    const low = computeNba({ prospect: { ...base, status: "non_contacte", fit_score: 10 } });
    expect(high.action).toBe("rechercher");
    expect(high.priority).toBeGreaterThan(low.priority);
  });

  it("recherche faite sans brouillons → générer ; avec téléphone → appeler", () => {
    const gen = computeNba({ prospect: { ...base, status: "non_contacte" }, research: { signals: [] } });
    expect(gen.action).toBe("generer");
    const call = computeNba({
      prospect: { ...base, status: "non_contacte", phone: "+33 1 00" },
      research: { signals: [] },
      drafts: { id: "d1" },
    });
    expect(call.action).toBe("appeler");
  });
});
