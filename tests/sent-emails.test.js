import { describe, it, expect } from "vitest";
import { parseSentEmails, parseSentDate, normalizeStatus, planSentEmails, sentSummary, dedupKey } from "@/lib/sent-emails";

// Données fictives uniquement.
const AGENT = "```csv\nDate d'envoi;Email;Nom;Objet;Statut\n2026-11-24 10:05;contact@alpha-motors.fr;Jean Martin;DELL : Données et Sauvegardes;envoyé\n"
  + "2026-11-24 10:07;info@beta-indus.fr;Léa Roux;DELL : Données et Sauvegardes;réponse reçue\n"
  + "2026-11-24 10:09;jean@collegue.dell.com;Collègue;Point interne;envoyé\n"
  + "2026-11-24 10:10;contact@gamma.fr;Paul Petit;DELL : Données et Sauvegardes;non remis\n```";

describe("lecture des envois", () => {
  it("CSV de l'agent Sales Chat (bloc de code, ;) — adresses Dell ignorées", () => {
    const { rows, internal } = parseSentEmails(AGENT);
    expect(internal).toBe(1);
    expect(rows.map((r) => [r.to_email, r.status])).toEqual([
      ["contact@alpha-motors.fr", "envoye"], ["info@beta-indus.fr", "reponse"], ["contact@gamma.fr", "non_remis"],
    ]);
    expect(rows[0]).toMatchObject({ to_name: "Jean Martin", sent_at: "2026-11-24T10:05:00", subject: "DELL : Données et Sauvegardes" });
  });

  it("tableau Markdown", () => {
    const md = "| Date d'envoi | Email | Nom | Objet | Statut |\n|---|---|---|---|---|\n| 25/11/2026 09:30 | contact@alpha-motors.fr | Jean Martin | DELL : Test | Envoyé |";
    expect(parseSentEmails(md).rows[0]).toMatchObject({ to_email: "contact@alpha-motors.fr", sent_at: "2026-11-25T09:30:00" });
  });

  it("copie des Éléments envoyés d'Outlook (noms affichés, date « mer. 25/11/2026 14:32 »)", () => {
    const tsv = "À\tObjet\tEnvoyé\tTaille\nJean Martin\tDELL : Données et Sauvegardes\tmer. 25/11/2026 14:32\t45 Ko\n'contact@gamma.fr'\tDELL : Test\t25/11/2026 15:01\t40 Ko";
    const { rows } = parseSentEmails(tsv);
    expect(rows[0]).toMatchObject({ to_email: "", to_name: "Jean Martin", sent_at: "2026-11-25T14:32:00" });
    expect(rows[1]).toMatchObject({ to_email: "contact@gamma.fr" });
  });

  it("export CSV d'Outlook (À: (nom) / À: (adresse)), plusieurs destinataires", () => {
    const csv = '"Objet","Corps","À: (nom)","À: (adresse)"\n"DELL : Test","…","Jean Martin","contact@alpha-motors.fr;info@alpha-motors.fr"';
    const { rows } = parseSentEmails(csv);
    expect(rows.map((r) => r.to_email)).toEqual(["contact@alpha-motors.fr", "info@alpha-motors.fr"]);
    expect(rows[0].to_name).toBe("Jean Martin");
    expect(rows[0].sent_at).toBeNull();
  });

  it("dates et statuts", () => {
    expect(parseSentDate("2026-11-24")).toBe("2026-11-24T12:00:00");
    expect(parseSentDate("11/25/2026 2:32 PM")).toBe("2026-11-25T14:32:00"); // format américain
    expect(parseSentDate("03/04/2026")).toBe("2026-04-03T12:00:00"); // jj/mm par défaut
    expect(normalizeStatus("Undeliverable")).toBe("non_remis");
    expect(normalizeStatus("STOP — ne plus contacter")).toBe("stop");
    expect(normalizeStatus("")).toBe("envoye");
  });
});

describe("rattachement et contrôles", () => {
  const leads = [
    { id: "a", name: "ALPHA MOTORS", health_status: "active", sf_lead_status: "New", domain: "alpha-motors.fr",
      email: { email: "contact@alpha-motors.fr" }, recipient: { name: "Jean Martin" },
      emails_sent: [{ to: "contact@alpha-motors.fr", at: "2026-11-10T10:00:00", status: "envoye", key: "old" }] },
    { id: "b", name: "BETA INDUS", health_status: "active", sf_lead_status: "Working", found_email: "info@beta-indus.fr", email_opt_out: true },
    { id: "c", name: "GAMMA", health_status: "active", sf_lead_status: "Closed by Sales", found_email: "contact@gamma.fr" },
    { id: "d", name: "DELTA", health_status: "active", sf_lead_status: "New", domain: "delta.fr", call_status: "rdv" },
  ];
  it("rattache par adresse, domaine ou nom, et signale les erreurs", () => {
    const rows = [
      { to_email: "", to_name: "Jean Martin", subject: "DELL : Test", sent_at: "2026-11-24T10:00:00", status: "envoye" },
      { to_email: "info@beta-indus.fr", to_name: "", subject: "DELL : Test", sent_at: "2026-11-24T10:00:00", status: "reponse" },
      { to_email: "contact@gamma.fr", to_name: "", subject: "DELL : Test", sent_at: "2026-11-24T10:00:00", status: "non_remis" },
      { to_email: "direction@delta.fr", to_name: "", subject: "DELL : Test", sent_at: "2026-11-24T10:00:00", status: "envoye" },
      { to_email: "x@inconnu.fr", to_name: "", subject: "DELL : Test", sent_at: "2026-11-24T10:00:00", status: "envoye" },
    ];
    const plan = planSentEmails(rows, leads);
    expect(plan.entries.map((e) => e.account_id)).toEqual(["a", "b", "c", "d"]);
    expect(plan.unmatched).toEqual(["x@inconnu.fr"]);
    const kinds = plan.issues.map((i) => `${i.lead_id}:${i.kind}`);
    expect(kinds).toEqual(expect.arrayContaining(["a:doublon", "b:stop", "b:reponse", "c:clos", "c:non_remis", "d:traite"]));
    expect(plan.updates.find((u) => u.id === "c")).toMatchObject({ bounced_emails: ["contact@gamma.fr"], found_email: null });
  });
  it("un même envoi collé deux fois n'est compté qu'une fois, avec le statut le plus avancé", () => {
    const r = { to_email: "contact@alpha-motors.fr", to_name: "", subject: "DELL : Test", sent_at: "2026-12-10T10:00:00" };
    const plan = planSentEmails([{ ...r, status: "envoye" }, { ...r, status: "reponse" }], leads);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].status).toBe("reponse");
    expect(plan.issues.some((i) => i.kind === "doublon")).toBe(false); // 30 jours après le précédent envoi
  });
  it("résumé des envois d'un lead", () => {
    const s = sentSummary([{ to_email: "a@a.fr", sent_at: "2026-11-01", status: "envoye" }, { to_email: "a@a.fr", sent_at: "2026-11-05", status: "reponse" }]);
    expect(s).toMatchObject({ last_email_at: "2026-11-05", email_replied: true, email_status: "reponse" });
    expect(dedupKey({ to_email: "a@a.fr", subject: "RE: DELL : Test", sent_at: "2026-11-05T10:00" })).toBe("a@a.fr|dell test|2026-11-05");
  });
});
