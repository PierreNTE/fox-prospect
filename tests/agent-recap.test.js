import { describe, it, expect } from "vitest";
import { parseAgentRecap, planRecapUpdates, companyKey } from "@/lib/agent-recap";

const MARKDOWN = `
| N° | Société | Email | Confiance | Statut | Raison |
|---|---|---|---|---|---|
| 1 | ALPHA MOTORS SAS | contact@alpha-motors.fr | sûr | brouillon — mar. 24/11 | |
| 2 | BETA CONSEIL | | à trouver | ignoré | email introuvable — à appeler : 02 41 00 00 00 |
| 3 | GAMMA SARL | it@gamma.fr | probable | prêt à envoyer — mer. 25/11 | |

Non vérifié : Opt Out Salesforce, statut client, commercial Dell attitré (pas d'accès).

**Emails trouvés**
| Société | Email | Source |
|---|---|---|
| GAMMA SARL | it@gamma.fr | https://gamma.fr/mentions-legales |

**Rebonds**
- contact@delta.fr

**Nouveaux STOP**
- epsilon@epsilon.fr

1 prêt à envoyer, 1 brouillon, 1 ignoré.
`;

const TABS = "N°\tSociété\tEmail\tConfiance\tStatut\tRaison\n1\tALPHA MOTORS SAS\tcontact@alpha-motors.fr\tsûr\tbrouillon — mar. 24/11\t\nEmails trouvés\nSociété\tEmail\tSource\nGAMMA SARL\tit@gamma.fr\tsite officiel";

describe("retour de l'agent Sales Chat", () => {
  it("lit un récapitulatif en tableaux Markdown", () => {
    const r = parseAgentRecap(MARKDOWN);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ societe: "ALPHA MOTORS SAS", email: "contact@alpha-motors.fr", drafted: true });
    expect(r.rows[1]).toMatchObject({ societe: "BETA CONSEIL", drafted: false });
    expect(r.rows[2].drafted).toBe(true);
    expect(r.found).toEqual([{ societe: "GAMMA SARL", email: "it@gamma.fr", source: "https://gamma.fr/mentions-legales" }]);
    expect(r.bounces).toEqual(["contact@delta.fr"]);
    expect(r.stops).toEqual([{ email: "epsilon@epsilon.fr", societe: "" }]);
  });
  it("lit un tableau copié depuis l'interface (tabulations)", () => {
    const r = parseAgentRecap(TABS);
    expect(r.rows[0]).toMatchObject({ societe: "ALPHA MOTORS SAS", drafted: true });
    expect(r.found[0]).toMatchObject({ societe: "GAMMA SARL", email: "it@gamma.fr", source: "site officiel" });
  });
  it("met à jour les bons leads : export, email trouvé, rebond, STOP", () => {
    const leads = [
      { id: "a", name: "ALPHA MOTORS", email: { email: "contact@alpha-motors.fr" } },
      { id: "b", name: "BETA CONSEIL" },
      { id: "g", name: "GAMMA", sirene_name: "GAMMA SARL" },
      { id: "d", name: "DELTA SAS", found_email: "contact@delta.fr", email: { email: "contact@delta.fr" } },
      { id: "e", name: "EPSILON", email: { email: "epsilon@epsilon.fr" } },
      { id: "m", name: "OMEGA", found_email: "x@omega.fr", found_email_source: "manuel" },
    ];
    const { updates, unmatched } = planRecapUpdates(parseAgentRecap(MARKDOWN), leads);
    const by = Object.fromEntries(updates.map((u) => [u.id, u]));
    expect(by.a.email_exported_at).toBeTruthy();
    expect(by.b).toBeUndefined();
    expect(by.g).toMatchObject({ found_email: "it@gamma.fr", found_email_source: "agent Sales Chat (https://gamma.fr/mentions-legales)" });
    expect(by.g.email_exported_at).toBeTruthy();
    expect(by.d).toMatchObject({ bounced_emails: ["contact@delta.fr"], found_email: null });
    expect(by.e).toMatchObject({ email_opt_out: true });
    expect(unmatched).toEqual([]);
  });
  it("noms comparés sans forme juridique", () => {
    expect(companyKey("Gamma S.A.R.L.")).toBe(companyKey("GAMMA"));
    expect(companyKey("ALPHA MOTORS SAS")).toBe("ALPHA MOTORS");
  });
});

import { pickEmail } from "@/lib/who-to-call";
import { buildExportRows } from "@/lib/sales-chat";

describe("STOP et rebonds dans l'export", () => {
  it("un email revenu en erreur n'est plus proposé", () => {
    const account = { web_intel: { emails: { generic: ["contact@alpha.fr", "info@alpha.fr"], named: [] } }, bounced_emails: ["contact@alpha.fr"] };
    expect(pickEmail({ account }).email).toBe("info@alpha.fr");
  });
  it("une société en STOP ne part plus dans le fichier", () => {
    const rows = buildExportRows([
      { id: "1", name: "A", health_status: "active", recipient: { name: "Jean Martin" }, email: { email: "a@a.fr", confidence: "sûr" } },
      { id: "2", name: "B", health_status: "active", recipient: { name: "Léa Roux" }, email_opt_out: true, email: { email: "b@b.fr", confidence: "sûr" } },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1"]);
  });
});
