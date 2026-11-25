import { describe, it, expect } from "vitest";
import { parseHtmlTable, parseCsv, reportToLeads, parseReportText, decodeReport } from "@/lib/salesforce-report";
import { normalizeLeadStatus } from "@/lib/salesforce-leads";
import { sfStatusRank } from "@/lib/call-status";
import { isLeadOpen } from "@/lib/call-session";

// Données fictives, au format de l'export « .xls » de Salesforce (tableau HTML).
const XLS = `<head><META http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"></head><table><tr><th filter=all>Company / Account</th><th filter=all>Lead Tracking ID</th><th filter=all>Lead Status</th><th filter=all>Legal GU DUNS</th></tr>
<tr><td style="vnd.ms-excel.numberformat:@">ACME INDUSTRIE</td><td style="vnd.ms-excel.numberformat:@">L10000001</td><td style="vnd.ms-excel.numberformat:@">New</td><td style="vnd.ms-excel.numberformat:@">100000001</td></tr>
<tr><td>Commune des Cr&ecirc;tes &amp; Vall&#233;es</td><td>L10000002</td><td>Working</td><td></td></tr>
<tr><td>Beta Systems AB</td><td>L10000003</td><td>Rejected by Sales</td><td>100000003</td></tr>
<tr><td>Gamma SAS</td><td>L10000004</td><td>Closed by Sales</td><td>100000004</td></tr>
</table>`;

describe("report Salesforce (.xls HTML)", () => {
  it("lit les colonnes société, ID, statut et DUNS", () => {
    const { rows, diagnostic } = parseReportText(XLS);
    expect(diagnostic.columns).toEqual(expect.arrayContaining(["company", "status", "sf_lead_id", "duns"]));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ company: "ACME INDUSTRIE", status: "New", sf_lead_id: "L10000001", duns: "100000001" });
    expect(rows[1].company).toBe("Commune des Crêtes & Vallées");
    expect(rows[2].status).toBe("Rejected by Sales");
  });

  it("garde l'en-tête même avec des lignes vides", () => {
    const t = parseHtmlTable("<table><tr><th>A</th></tr><tr><td>x</td></tr></table>");
    expect(t).toEqual({ headers: ["A"], rows: [["x"]] });
  });

  it("décode un fichier Windows-1252 annoncé en ISO-8859-1", () => {
    const head = '<META content="text/html; charset=ISO-8859-1"><table><tr><th>Company</th></tr><tr><td>Cr';
    const bytes = new Uint8Array([...new TextEncoder().encode(head), 0xea, ...new TextEncoder().encode("tes</td></tr></table>")]);
    expect(parseReportText(decodeReport(bytes)).rows[0].company).toBe("Crêtes");
  });
});

describe("report Salesforce (.csv)", () => {
  it("lit un CSV avec guillemets et ignore le pied de report", () => {
    const csv = [
      '"Company / Account","Lead Tracking ID","Lead Status","City"',
      '"Delta, Fils & Cie","L20000001","Working","Nantes"',
      '"Epsilon","L20000002","N",""',
      "",
      '"Lead List Report"',
      '"Copyright (c) 2000-2026 salesforce.com, inc. All rights reserved."',
    ].join("\r\n");
    const { rows } = reportToLeads(parseCsv(csv));
    expect(rows.map((r) => r.company)).toEqual(["Delta, Fils & Cie", "Epsilon"]);
    expect(rows[0]).toMatchObject({ status: "Working", city: "Nantes", sf_lead_id: "L20000001" });
    expect(rows[1].status).toBe("New");
  });

  it("refuse un fichier sans colonne société", () => {
    const { rows, diagnostic } = reportToLeads(parseCsv("Foo;Bar\n1;2"));
    expect(rows).toEqual([]);
    expect(diagnostic.error).toMatch(/société/);
  });
});

describe("statut « Rejected by Sales »", () => {
  it("compte comme un lead clos", () => {
    expect(normalizeLeadStatus("Rejected by Sales")).toBe("Rejected by Sales");
    expect(sfStatusRank("Rejected by Sales")).toBe(3);
    expect(isLeadOpen({ health_status: "active", sf_lead_status: "Rejected by Sales" })).toBe(false);
  });
});
