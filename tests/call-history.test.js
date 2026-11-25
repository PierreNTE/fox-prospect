import { describe, it, expect } from "vitest";
import { attemptsInfo, mondayOf, weekStats } from "@/lib/call-history";

describe("tentatives d'un lead", () => {
  it("compte les appels et les essais sans réponse d'affilée", () => {
    const calls = [
      { outcome: "pas_joignable", at: "2026-01-05T09:00:00Z" },
      { outcome: "rappeler", at: "2026-01-06T09:00:00Z" },
      { outcome: "pas_joignable", at: "2026-01-08T09:00:00Z" },
      { outcome: "pas_joignable", at: "2026-01-07T09:00:00Z" },
    ];
    expect(attemptsInfo(calls)).toEqual({ attempts: 4, no_answer_streak: 2, last_call_at: "2026-01-08T09:00:00Z" });
    expect(attemptsInfo([])).toEqual({ attempts: 0, no_answer_streak: 0, last_call_at: null });
  });
});

describe("bilan de la semaine", () => {
  it("trouve le lundi", () => {
    expect(mondayOf("2026-01-08")).toBe("2026-01-05");
    expect(mondayOf("2026-01-05")).toBe("2026-01-05");
    expect(mondayOf("2026-01-11")).toBe("2026-01-05");
  });

  it("compte appels, joints, RDV et résultats par verdict, sur la semaine en cours seulement", () => {
    const dayOf = (at) => at.slice(0, 10);
    const leads = [
      { brief: { verdict: "appeler", verdict_label: "Appeler" }, calls: [
        { outcome: "pas_joignable", at: "2026-01-05T09:00:00Z" },
        { outcome: "rdv", at: "2026-01-06T09:00:00Z" },
      ] },
      { brief: { verdict: "verifier", verdict_label: "À vérifier" }, calls: [
        { outcome: "pas_interesse", at: "2026-01-06T10:00:00Z" },
        { outcome: "faux_numero", at: "2025-12-30T10:00:00Z" }, // semaine précédente
      ] },
      { calls: [] },
    ];
    const w = weekStats(leads, "2026-01-08", { dayOf });
    expect(w.start).toBe("2026-01-05");
    expect(w.calls).toBe(3);
    expect(w.leads_called).toBe(2);
    expect(w.reached).toBe(2);
    expect(w.rdv).toBe(1);
    expect(w.no_answer).toBe(1);
    expect(w.wrong).toBe(0);
    expect(w.reach_rate).toBe(67);
    expect(w.rdv_rate).toBe(50);
    expect(w.by_verdict.appeler).toEqual({ label: "Appeler", calls: 2, reached: 1, rdv: 1 });
    expect(w.by_day.map((d) => d.calls)).toEqual([1, 2, 0, 0, 0]);
    const we = weekStats([{ emails_sent: [{ at: "2026-01-06T10:00:00Z", status: "reponse" }, { at: "2026-01-07T10:00:00Z", status: "envoye" },
      { at: "2025-12-29T10:00:00Z", status: "envoye" }] }], "2026-01-08", { dayOf });
    expect([we.emails, we.email_replies]).toEqual([2, 1]);
  });
});
