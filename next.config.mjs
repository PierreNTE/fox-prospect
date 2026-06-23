/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tree-shaking ciblé des gros "barrels" Fluent : sans ça, chaque page qui
  // importe une icône tire des milliers de modules → lag à la navigation (dev)
  // et bundle gonflé (prod). Next ne charge plus que les symboles réellement
  // utilisés. Gain net sur le clic des icônes du rail.
  experimental: {
    optimizePackageImports: ["@fluentui/react-icons", "@fluentui/react-components"],
  },
  // En-têtes de sécurité appliqués à toutes les routes. La CSP autorise les styles
  // ET scripts inline (Fluent UI = styles inline Griffel ; Next = scripts d'hydratation
  // inline) — elle n'offre donc pas de protection XSS forte, mais ferme les vecteurs
  // d'exfiltration/détournement : object-src/base-uri/form-action verrouillés,
  // connect-src limité à l'origine, frame-ancestors none (anti-clickjacking).
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default nextConfig;
