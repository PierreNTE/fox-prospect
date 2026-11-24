import { describe, it, expect } from "vitest";
import { sfStatusRank, sortLeadsByStatus } from "@/lib/call-status";
import { deleteAllLeads } from "@/lib/leads-reset";

describe("tri des leads par statut Salesforce", () => {
  it("classe New, puis Working, puis les autres, puis Closed", () => {
    expect(sfStatusRank("New")).toBe(0);
    expect(sfStatusRank("N")).toBe(0);
    expect(sfStatusRank("Working")).toBe(1);
    expect(sfStatusRank("Qualified")).toBe(2);
    expect(sfStatusRank("")).toBe(2);
    expect(sfStatusRank("Closed by Sales")).toBe(3);
  });

  it("garde l'ordre de priorité dans chaque groupe, rappels du jour d'abord", () => {
    const leads = [
      { id: "a", sf_lead_status: "Closed by Sales" },
      { id: "b", sf_lead_status: "Working" },
      { id: "c", sf_lead_status: "New" },
      { id: "d", sf_lead_status: "Working", recall_at: "2026-01-10" },
      { id: "e", sf_lead_status: "New" },
      { id: "f", sf_lead_status: "Qualified" },
    ];
    const ids = sortLeadsByStatus(leads, "2026-01-10").map((l) => l.id);
    expect(ids).toEqual(["c", "e", "d", "b", "f", "a"]);
  });
});

// Supabase factice : enregistre les suppressions demandées.
function fakeSupabase(ids) {
  const log = [];
  const builder = (table) => {
    const q = { table, op: null, filters: [] };
    const api = {
      select() { q.op = "select"; return api; },
      delete() { q.op = "delete"; return api; },
      eq(col, val) { q.filters.push([col, val]); return api; },
      in(col, vals) { q.filters.push([col, vals]); log.push({ table, op: q.op, col, n: vals.length }); return Promise.resolve({ error: null }); },
      range(from, to) { return Promise.resolve({ data: ids.slice(from, to + 1).map((id) => ({ id })), error: null }); },
    };
    return api;
  };
  return { from: builder, log };
}

describe("suppression de tous les leads", () => {
  it("supprime les comptes Salesforce et leurs recherches en file", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const sb = fakeSupabase(ids);
    const r = await deleteAllLeads(sb);
    expect(r.deleted).toBe(250);
    const accounts = sb.log.filter((e) => e.table === "accounts");
    expect(accounts.map((e) => e.n)).toEqual([200, 50]);
    expect(sb.log.some((e) => e.table === "scrape_jobs" && e.col === "params->>account_id")).toBe(true);
  });

  it("ne fait rien sans lead", async () => {
    const sb = fakeSupabase([]);
    expect((await deleteAllLeads(sb)).deleted).toBe(0);
    expect(sb.log).toHaveLength(0);
  });
});
