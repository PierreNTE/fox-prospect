/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tree-shaking ciblé des gros "barrels" Fluent : sans ça, chaque page qui
  // importe une icône tire des milliers de modules → lag à la navigation (dev)
  // et bundle gonflé (prod). Next ne charge plus que les symboles réellement
  // utilisés. Gain net sur le clic des icônes du rail.
  experimental: {
    optimizePackageImports: ["@fluentui/react-icons", "@fluentui/react-components"],
  },
  // En-têtes de sécurité appliqués à toutes les routes. Volontairement sans CSP
  // stricte (Fluent UI injecte des styles inline → casserait l'app) ; on couvre
  // clickjacking, sniffing MIME, fuite de referrer, HTTPS forcé et permissions.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
