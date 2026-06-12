import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Fox Prospect",
  description: "Copilote de prospection B2B IT — qualification et points d'accroche",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=Instrument+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <path
                  d="M3 4l4 5h10l4-5v7c0 5-4 9-9 9s-9-4-9-9V4z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <circle cx="9" cy="12" r="1.1" fill="currentColor" />
                <circle cx="15" cy="12" r="1.1" fill="currentColor" />
                <path d="M12 15.5l-1.3 1.5h2.6L12 15.5z" fill="currentColor" />
              </svg>
            </span>
            <span className="brand-name">Fox Prospect</span>
          </Link>
          <nav className="nav">
            <Link href="/">Piste</Link>
            <Link href="/import">Importer</Link>
            <Link href="/settings">Réglages</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          Prospection B2B au sens RGPD : emails pro uniquement, lien avec la fonction, opposition
          respectée en permanence. Envoi : toujours validé par un humain.
        </footer>
      </body>
    </html>
  );
}
