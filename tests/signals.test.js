import { describe, it, expect } from "vitest";
import { mergeSignals } from "@/lib/signals";

describe("mergeSignals", () => {
  it("normalise les lignes company_signals (observed_at/source_url → date/source)", () => {
    const merged = mergeSignals(
      [{ type: "rfp_it", detail: "AO cyber", observed_at: "2026-06-01", source_url: "https://boamp.fr/x", base_weight: 40 }],
      []
    );
    expect(merged[0]).toMatchObject({ type: "rfp_it", date: "2026-06-01", source: "https://boamp.fr/x", base_weight: 40 });
  });

  it("déduplique par type + détail, la table prime sur le JSONB", () => {
    const merged = mergeSignals(
      [{ type: "recrutement", detail: "Recrutement RSSI", observed_at: "2026-06-01" }],
      [{ type: "recrutement", detail: "recrutement rssi", date: "2026-05" }, { type: "levee", detail: "Série B", date: "2026-04" }]
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].date).toBe("2026-06-01");
  });

  it("tolère les tableaux vides et absents", () => {
    expect(mergeSignals()).toEqual([]);
    expect(mergeSignals([], [])).toEqual([]);
  });
});
