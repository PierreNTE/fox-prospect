export default function manifest() {
  return {
    name: "Fox Prospect",
    short_name: "Fox Prospect",
    description: "Copilote de prospection B2B IT — qualification, accroches et brouillons.",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f1ef",
    theme_color: "#d4571d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
