import { describe, it, expect } from "vitest";
import { estPanneEnvironnement } from "@/lib/process-jobs";

// Ces messages ne sont pas inventés : le premier est le `last_error` exact
// partagé par les 256 jobs trouvés en `error` définitif le 2026-07-27, tous à
// trois tentatives épuisées. Le plafond du compte frappait la file entière ;
// trois passages du drain ont suffi à la condamner.
describe("estPanneEnvironnement — le monde autour du job, pas le job", () => {
  const environnement = [
    'Anthropic API 400: {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-08-01"}}',
    "Anthropic 429: rate limit exceeded",
    "Anthropic 529: Overloaded",
    "Your credit balance is too low to access the Anthropic API",
    "Budget mensuel atteint (15.02 € / 15 €).",
    "Rythme de dépense atteint pour aujourd'hui",
    "fetch failed",
    "connect ETIMEDOUT 160.79.104.10:443",
    "The operation was aborted due to timeout",
  ];

  const jobFautif = [
    "Prospect introuvable",
    "Compte introuvable",
    "Kind non géré : bidule",
    "Anthropic API 400: invalid_request_error: max_tokens must be positive",
    "insert or update on table \"research\" violates foreign key constraint",
  ];

  it.each(environnement)("replanifie sans consommer de tentative : %s", (m) => {
    expect(estPanneEnvironnement(m)).toBe(true);
  });

  it.each(jobFautif)("laisse échouer pour de bon : %s", (m) => {
    expect(estPanneEnvironnement(m)).toBe(false);
  });

  it("ne tombe pas sur une entrée vide ou nulle", () => {
    expect(estPanneEnvironnement(null)).toBe(false);
    expect(estPanneEnvironnement(undefined)).toBe(false);
    expect(estPanneEnvironnement("")).toBe(false);
  });

  it("ne confond pas un 429 dans une URL avec une saturation", () => {
    // La borne de mot évite qu'un identifiant quelconque déclenche la règle.
    expect(estPanneEnvironnement("Prospect 4297 introuvable")).toBe(false);
  });
});
