import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pacingState, budgetMessage, monthlyBudgetEur, dailyLlmCount } from "@/lib/budget";

// Le lissage est né d'un constat de facture : en juillet 2026, les 15 € du mois
// ont été consommés entre le 1er et le 4, laissant vingt-trois jours sans outil.
// Ces tests rejouent cette dépense réelle contre la règle.
const JUILLET = (jour) => new Date(Date.UTC(2026, 6, jour, 12, 0, 0));

describe("pacingState — allocation au prorata du mois", () => {
  beforeEach(() => { delete process.env.BUDGET_PACING; });
  afterEach(() => { delete process.env.BUDGET_PACING; });

  it("compte les jours du mois sans table (juillet = 31)", () => {
    expect(pacingState(JUILLET(1), 15).daysInMonth).toBe(31);
  });

  it("gère février d'une année bissextile", () => {
    // 2028 est bissextile : 29 jours. Une table figée s'y trompe.
    expect(pacingState(new Date(Date.UTC(2028, 1, 10)), 15).daysInMonth).toBe(29);
  });

  it("ouvre une réserve le 1er, sinon l'outil est inutilisable ce jour-là", () => {
    const { allowance } = pacingState(JUILLET(1), 15);
    // 15/31 acquis + 15% de réserve = 0,48 + 2,25
    expect(allowance).toBeCloseTo(2.73, 2);
    // Sans réserve, le 1er n'autoriserait qu'une douzaine de qualifications.
    expect(allowance).toBeGreaterThan(15 / 31);
  });

  it("aurait coupé la dépense réelle du 1er au 4 juillet", () => {
    // Dépense constatée dans ai_runs, cumulée.
    const reel = { 1: 3.04, 2: 5.98, 3: 8.52, 4: 9.87 };
    for (const [jour, cumul] of Object.entries(reel)) {
      const { allowance } = pacingState(JUILLET(Number(jour)), 15);
      expect(cumul).toBeGreaterThan(allowance);   // coupé chaque jour
    }
    // Au 4 juillet, le lissage aurait laissé passer 4,19 € au lieu de 9,87 €.
    expect(pacingState(JUILLET(4), 15).allowance).toBeCloseTo(4.19, 2);
  });

  it("libère tout le budget en fin de mois", () => {
    expect(pacingState(JUILLET(31), 15).allowance).toBe(15);
  });

  it("ne dépasse jamais le budget mensuel, réserve comprise", () => {
    for (let j = 1; j <= 31; j++) {
      expect(pacingState(JUILLET(j), 15).allowance).toBeLessThanOrEqual(15);
    }
  });

  it("l'autorisation ne recule jamais d'un jour au suivant", () => {
    let precedent = 0;
    for (let j = 1; j <= 31; j++) {
      const { allowance } = pacingState(JUILLET(j), 15);
      expect(allowance).toBeGreaterThanOrEqual(precedent);
      precedent = allowance;
    }
  });

  it("BUDGET_PACING=off rend tout le budget disponible immédiatement", () => {
    process.env.BUDGET_PACING = "off";
    expect(pacingState(JUILLET(1), 15).allowance).toBe(15);
  });
});

describe("budgetMessage — dire la bonne cause", () => {
  it("annonce une reprise DEMAIN quand c'est le rythme qui coupe", () => {
    const msg = budgetMessage({ reason: "rythme", spent: 4.2, budget: 15, allowance: 4.19 });
    expect(msg).toContain("demain");
    expect(msg).not.toContain("1er du mois");
  });

  it("annonce le 1er du mois quand c'est le plafond mensuel", () => {
    const msg = budgetMessage({ reason: "mois", spent: 15.2, budget: 15, allowance: 15 });
    expect(msg).toContain("1er du mois");
  });
});

describe("monthlyBudgetEur", () => {
  afterEach(() => { delete process.env.MONTHLY_BUDGET_EUR; });

  // 15 € : la cible réelle. Ce plafond a valu 13 € le temps de compenser un
  // tarif Haiku périmé dans ANTHROPIC_TARIF ; celui-ci corrigé, ai_runs colle à
  // la facture et le rabais n'a plus lieu d'être — il déduirait deux fois la
  // même erreur. À 15 €, la coupure tombe vers 16 $, sous le plafond de compte
  // à 20 $ : les deux ne se protègent l'un l'autre que s'ils sont accordés.
  it("vaut 15 € par défaut, accordé au plafond de compte", () => {
    expect(monthlyBudgetEur()).toBe(15);
  });

  it("suit la variable d'environnement", () => {
    process.env.MONTHLY_BUDGET_EUR = "40";
    expect(monthlyBudgetEur()).toBe(40);
  });
});

// Ce compteur a existé en deux exemplaires qui ne comptaient pas la même chose :
// la route manuelle comptait les lignes `research`, le drain autonome comptait
// les comptes rafraîchis. Comme la file est faite de jobs `research_prospect`,
// qui ne touchent jamais `accounts.last_refreshed_at`, le compteur du drain
// valait zéro en permanence et son plafond ne mordait jamais. Le défaut a vécu
// des semaines sans se voir — d'où ces tests, qui verrouillent le fait que les
// DEUX sources de dépense entrent dans le compte.
describe("dailyLlmCount — plafond quotidien partagé", () => {
  const supabaseFactice = (comptes) => ({
    from: (table) => ({
      select: () => ({ gte: () => Promise.resolve({ count: comptes[table] ?? 0 }) }),
    }),
  });

  it("additionne les qualifications et les analyses de comptes", async () => {
    const n = await dailyLlmCount(supabaseFactice({ research: 30, accounts: 12 }));
    expect(n).toBe(42);
  });

  it("compte les qualifications seules — le cas que le drain ratait", async () => {
    const n = await dailyLlmCount(supabaseFactice({ research: 47, accounts: 0 }));
    expect(n).toBe(47);
  });

  it("compte les analyses de comptes seules", async () => {
    expect(await dailyLlmCount(supabaseFactice({ research: 0, accounts: 9 }))).toBe(9);
  });

  it("traite un compte absent comme zéro et non comme NaN", async () => {
    expect(await dailyLlmCount(supabaseFactice({}))).toBe(0);
  });
});
