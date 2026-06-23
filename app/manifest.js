// Manifest PWA via la convention App Router (servi sur /manifest.webmanifest et
// lié automatiquement dans le <head> — ne pas dupliquer via metadata.manifest).
export default function manifest() {
  return {
    name: "Fox Prospect",
    short_name: "Fox Prospect",
    description: "Copilote de prospection B2B IT — qualification IA, accroches et brouillons.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#5B53E6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
