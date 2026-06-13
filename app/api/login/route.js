import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(request) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    // Pas de mot de passe configuré (local) : rien à faire.
    return NextResponse.json({ ok: true });
  }

  const { username, password } = await request.json().catch(() => ({}));
  const user = process.env.APP_USER || "pierre";

  if (username !== user || password !== appPassword) {
    return NextResponse.json(
      { error: "Identifiant ou mot de passe incorrect." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await sessionToken(user, appPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: THIRTY_DAYS,
    path: "/",
  });
  return response;
}
