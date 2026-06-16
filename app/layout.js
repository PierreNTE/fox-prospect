import "./globals.css";
import Link from "next/link";
import SwRegister from "./sw-register";
import FluentRoot from "./fluent-root";
import { FoxLogo } from "@/components/FoxLogo";

export const metadata = {
  title: "Fox Prospect",
  description: "Copilote de prospection B2B IT — qualification et points d'accroche",
  appleWebApp: { capable: true, title: "Fox Prospect", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport = {
  themeColor: "#5B53E6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <SwRegister />
        <FluentRoot>
          <header className="topbar">
            <Link href="/" className="brand">
              <FoxLogo />
            </Link>
            <nav className="nav">
              <Link href="/">Piste</Link>
              <Link href="/accounts">Comptes</Link>
              <Link href="/scraping">Scraping</Link>
              <Link href="/import">Importer</Link>
              <Link href="/analytics">Analyse</Link>
              <Link href="/settings">Réglages</Link>
            </nav>
          </header>
          <main className="container">{children}</main>
        </FluentRoot>
      </body>
    </html>
  );
}
