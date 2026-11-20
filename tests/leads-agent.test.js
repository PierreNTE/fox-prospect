import { describe, it, expect } from "vitest";
import { selectAgentTargets, agentWeeklyMax, AGENT_DEFAULT_MAX } from "@/lib/leads-agent";
import { estPanneEnvironnement } from "@/lib/process-jobs";

const lead = (id, tier, extra = {}) => ({
  id, name: `Société ${id}`, health_status: "active", sf_lead_status: "Open",
  call_prep_at: null, priority: { tier }, ...extra,
});

describe("agent hebdomadaire des leads", () => {
  const leads = [
    lead("a1", "A"), lead("a2", "A", { call_prep_at: "2026-11-01" }), lead("b1", "B"),
    lead("c1", "C"), lead("x1", "X"), lead("f1", "A", { health_status: "fermee" }),
    lead("v1", "A", { health_status: "vigilance" }), lead("k1", "A", { sf_lead_status: "Closed - Not Converted" }),
    lead("b2", "B"),
  ];

  it("ne retient que les comptes A/B actifs, ouverts et sans fiche, dans l'ordre", () => {
    expect(selectAgentTargets(leads, { room: 10 }).map((l) => l.id)).toEqual(["a1", "b1", "b2"]);
  });

  it("respecte le plafond de la semaine", () => {
    expect(selectAgentTargets(leads, { room: 2 }).map((l) => l.id)).toEqual(["a1", "b1"]);
    expect(selectAgentTargets(leads, { room: 0 })).toEqual([]);
  });

  it("ignore les comptes déjà en file", () => {
    expect(selectAgentTargets(leads, { room: 10, queued: new Set(["a1"]) }).map((l) => l.id)).toEqual(["b1", "b2"]);
  });

  it("plafond par défaut et réglage AGENT_PREP_MAX", () => {
    const prev = process.env.AGENT_PREP_MAX;
    delete process.env.AGENT_PREP_MAX;
    expect(agentWeeklyMax()).toBe(AGENT_DEFAULT_MAX);
    process.env.AGENT_PREP_MAX = "0";
    expect(agentWeeklyMax()).toBe(0);
    process.env.AGENT_PREP_MAX = "40";
    expect(agentWeeklyMax()).toBe(40);
    if (prev === undefined) delete process.env.AGENT_PREP_MAX; else process.env.AGENT_PREP_MAX = prev;
  });

  it("un plafond budgétaire replanifie le job au lieu de l'abandonner", () => {
    expect(estPanneEnvironnement("Budget mensuel atteint (15.00 € / 15 €).")).toBe(true);
    expect(estPanneEnvironnement("Your credit balance is too low")).toBe(true);
  });
});

import { selectScrapeTargets } from "@/lib/leads-agent";

describe("recherche des décideurs IT (worker de scraping)", () => {
  const leads = [
    { id: "a", health_status: "active", priority: { tier: "A" } },
    { id: "b", health_status: "active", priority: { tier: "B" }, call_prep_at: "2026-11-01" },
    { id: "c", health_status: "active", priority: { tier: "C" } },
    { id: "f", health_status: "fermee", priority: { tier: "X" } },
    { id: "k", health_status: "active", sf_lead_status: "Closed", priority: { tier: "A" } },
  ];
  it("A/B actifs et ouverts, même déjà préparés par l'IA", () => {
    expect(selectScrapeTargets(leads, { room: 10 }).map((l) => l.id)).toEqual(["a", "b"]);
  });
  it("jamais deux fois le même compte, plafond respecté", () => {
    expect(selectScrapeTargets(leads, { room: 10, already: new Set(["a"]) }).map((l) => l.id)).toEqual(["b"]);
    expect(selectScrapeTargets(leads, { room: 1 }).map((l) => l.id)).toEqual(["a"]);
  });
});
