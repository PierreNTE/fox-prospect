import { NextResponse } from "next/server";

// Protection minimale par Basic Auth : indispensable car l'app déployée
// consomme TA clé API Anthropic. Sans APP_PASSWORD défini, l'app reste ouverte
// (pratique en local), mais ne déploie jamais sur Vercel sans le définir.
export function middleware(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const user = process.env.APP_USER || "pierre";
  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    try {
      const [u, p] = atob(encoded).split(":");
      if (u === user && p === password) return NextResponse.next();
    } catch {
      // Base64 malformé : on retombe sur le 401 ci-dessous au lieu de crasher en 500.
    }
  }

  return new NextResponse("Authentification requise", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Fox Prospect"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
