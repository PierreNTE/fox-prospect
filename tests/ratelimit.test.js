import { describe, it, expect } from "vitest";
import { rateLimit } from "@/lib/ratelimit";

describe("rateLimit", () => {
  it("laisse passer sous la limite puis bloque au-delà", () => {
    const key = "test:under";
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, { max: 5, windowMs: 60_000 }).limited).toBe(false);
    }
    expect(rateLimit(key, { max: 5, windowMs: 60_000 }).limited).toBe(true);
  });

  it("les clés sont indépendantes", () => {
    expect(rateLimit("test:a", { max: 1, windowMs: 60_000 }).limited).toBe(false);
    expect(rateLimit("test:a", { max: 1, windowMs: 60_000 }).limited).toBe(true);
    expect(rateLimit("test:b", { max: 1, windowMs: 60_000 }).limited).toBe(false);
  });

  it("réinitialise après la fenêtre", () => {
    const key = "test:window";
    expect(rateLimit(key, { max: 1, windowMs: -1 }).limited).toBe(false); // fenêtre déjà expirée
    expect(rateLimit(key, { max: 1, windowMs: 60_000 }).limited).toBe(false); // repart à zéro
  });

  it("décompte remaining", () => {
    const r1 = rateLimit("test:remaining", { max: 3, windowMs: 60_000 });
    const r2 = rateLimit("test:remaining", { max: 3, windowMs: 60_000 });
    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
  });
});
