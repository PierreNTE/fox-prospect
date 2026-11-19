import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Session mémorisée un an sur l'appareil : on ne ressaisit pas l'identifiant à
// chaque visite. Changer APP_PASSWORD invalide toutes les sessions d'un coup.
const ONE_YEAR = 60 * 60 * 24 * 365;
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const MAX_ATTEMPTS = 10;

// Map persistante dans l'instance Node.js (stateful entre requêtes sur le même worker).
// Les workers Vercel sont éphémères mais c'est suffisant pour décourager les attaques brute-force.
const attempts = new Map();

function getIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= MAX_ATTEMPTS) return true;
  entry.count++;
  return false;
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

export async function POST(request) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return NextResponse.json({ ok: true });
  }

  const ip = getIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessaie dans 15 minutes." },
      { status: 429 }
    );
  }

  const { username, password } = await request.json().catch(() => ({}));
  const user = process.env.APP_USER || "pierre";

  if (username !== user || password !== appPassword) {
    return NextResponse.json(
      { error: "Identifiant ou mot de passe incorrect." },
      { status: 401 }
    );
  }

  // Connexion réussie : réinitialise le compteur pour cet IP.
  clearAttempts(ip);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await sessionToken(user, appPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ONE_YEAR,
    path: "/",
  });
  return response;
}
