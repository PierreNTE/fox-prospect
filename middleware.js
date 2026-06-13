import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

// Protection de l'app : indispensable car l'app déployée consomme TA clé API
// Anthropic. Sans APP_PASSWORD défini, l'app reste ouverte (pratique en local),
// mais ne déploie jamais sur Vercel sans le définir.
//
// Deux modes d'accès acceptés :
// 1. Cookie de session posé par la page /login (formulaire classique :
//    compatible Bitwarden et autres gestionnaires de mots de passe).
// 2. Basic Auth (en-tête Authorization) : conservé pour curl et l'outillage.
export async function middleware(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const user = process.env.APP_USER || "pierre";
  const { pathname } = request.nextUrl;

  // La page de connexion et sa route restent accessibles.
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  // Les tâches planifiées (cron Vercel) s'authentifient via CRON_SECRET dans leur route.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  // 1. Cookie de session
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && cookie === (await sessionToken(user, password))) {
    return NextResponse.next();
  }

  // 2. Basic Auth
  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    try {
      const [u, p] = atob(encoded).split(":");
      if (u === user && p === password) return NextResponse.next();
    } catch {
      // Base64 malformé : on retombe sur le refus ci-dessous au lieu de crasher en 500.
    }
  }

  // API : 401 explicite ; pages : redirection vers le formulaire de connexion.
  if (pathname.startsWith("/api/")) {
    return new NextResponse("Authentification requise", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Fox Prospect"' },
    });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Les ressources PWA (manifest, service worker, icônes) restent publiques :
  // elles ne contiennent rien de sensible et l'installation mobile les
  // télécharge parfois sans cookie.
  matcher: [
    "/((?!_next/|favicon.ico|manifest.webmanifest|sw.js|icon-192.png|icon-512.png|apple-touch-icon.png).*)",
  ],
};
