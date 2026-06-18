/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tree-shaking ciblé des gros "barrels" Fluent : sans ça, chaque page qui
  // importe une icône tire des milliers de modules → lag à la navigation (dev)
  // et bundle gonflé (prod). Next ne charge plus que les symboles réellement
  // utilisés. Gain net sur le clic des icônes du rail.
  experimental: {
    optimizePackageImports: ["@fluentui/react-icons", "@fluentui/react-components"],
  },
};
export default nextConfig;
