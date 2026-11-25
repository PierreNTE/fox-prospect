import { describe, it, expect } from "vitest";
import { toE164, telHref, addBusinessDays, buildCallQueue, primaryNumber, outcomePatch } from "@/lib/call-session";

describe("numéros", () => {
  it("passe au format international", () => {
    expect(toE164("01 23 45 67 89")).toBe("+33123456789");
    expect(toE164("06.00.00.00.00")).toBe("+33600000000");
    expect(toE164("+33 2 00 00 00 00")).toBe("+33200000000");
    expect(toE164("0033 3 00 00 00 00")).toBe("+33300000000");
    expect(toE164("")).toBe("");
    expect(telHref("02 00 00 00 00")).toBe("tel:+33200000000");
  });
});

describe("jours ouvrés", () => {
  it("saute le week-end", () => {
    expect(addBusinessDays("2026-01-08", 2)).toBe("2026-01-12"); // jeudi → lundi
    expect(addBusinessDays("2026-01-09", 1)).toBe("2026-01-12"); // vendredi → lundi
    expect(addBusinessDays("2026-01-05", 2)).toBe("2026-01-07");
  });
});

describe("file de la session", () => {
  const day = "2026-01-08";
  const base = { health_status: "active" };
  const leads = [
    { ...base, id: "closed", sf_lead_status: "Closed by Sales" },
    { ...base, id: "rdv", sf_lead_status: "New", call_status: "rdv" },
    { ...base, id: "later", sf_lead_status: "New", call_status: "rappeler", recall_at: "2026-01-20" },
    { ...base, id: "today", sf_lead_status: "New", call_status: "pas_joignable", call_updated_at: `${day}T09:00:00Z` },
    { ...base, id: "w1", sf_lead_status: "Working" },
    { ...base, id: "n1", sf_lead_status: "New" },
    { ...base, id: "due", sf_lead_status: "Working", call_status: "rappeler", recall_at: day, call_updated_at: "2026-01-05T09:00:00Z" },
    { health_status: "fermee", id: "ferme", sf_lead_status: "New" },
  ];
  it("garde les leads à appeler aujourd'hui, New d'abord, rappels dus en tête de groupe", () => {
    expect(buildCallQueue(leads, day).map((l) => l.id)).toEqual(["n1", "due", "w1"]);
  });
  it("met en fin de file les leads avec 3 essais sans réponse d'affilée", () => {
    const tired = { ...base, id: "tired", sf_lead_status: "New", no_answer_streak: 3 };
    expect(buildCallQueue([tired, ...leads], day).map((l) => l.id)).toEqual(["n1", "due", "w1", "tired"]);
  });
});

describe("numéro à composer", () => {
  it("la personne d'abord, sinon le standard", () => {
    expect(primaryNumber({ contact: { phone: "1" }, standard: { number: "2" } })).toEqual({ number: "1", kind: "contact" });
    expect(primaryNumber({ contact: { name: "x" }, standard: { number: "2" } })).toEqual({ number: "2", kind: "standard" });
    expect(primaryNumber({})).toBeNull();
  });
});

describe("résultat d'appel", () => {
  const day = "2026-01-08";
  it("répondeur : rappel à J+2 ouvrés", () => {
    expect(outcomePatch("pas_joignable", { day, note: "x" })).toEqual({ call_status: "pas_joignable", log_call: true, recall_at: "2026-01-12", call_note: "x" });
  });
  it("à rappeler : date choisie ou lendemain ouvré", () => {
    expect(outcomePatch("rappeler", { day, recallAt: "2026-01-15" }).recall_at).toBe("2026-01-15");
    expect(outcomePatch("rappeler", { day: "2026-01-09" }).recall_at).toBe("2026-01-12");
  });
  it("RDV : plus de rappel", () => {
    expect(outcomePatch("rdv", { day })).toEqual({ call_status: "rdv", log_call: true, recall_at: null });
  });
});
