"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { FoxMark, FoxLogo } from "@/components/FoxLogo";
import SearchModal from "@/components/SearchModal";
import OfflineBanner from "@/components/OfflineBanner";
import {
  Board24Regular,
  BuildingMultiple24Regular,
  ArrowImport24Regular,
  Settings24Regular,
  Search24Regular,
  Add24Regular,
  Alert24Regular,
  CalendarLtr24Regular,
  DataTrending24Regular,
} from "@fluentui/react-icons";

// Navigation resserrée sur le flux commercial : le Compte est le point de
// départ, puis les prospects, puis l'import. L'analyse reste joignable via le
// bouton « Activité » de la barre du haut (écran secondaire).
const NAV = [
  { href: "/accounts", label: "Comptes", Icon: BuildingMultiple24Regular },
  { href: "/", label: "Prospects", Icon: Board24Regular },
  { href: "/agenda", label: "Agenda", Icon: CalendarLtr24Regular },
  { href: "/pipeline", label: "Pipeline", Icon: DataTrending24Regular },
  { href: "/import", label: "Importer", Icon: ArrowImport24Regular },
];

const isActive = (path, href) => (href === "/" ? path === "/" : path.startsWith(href));

export default function AppShell({ children }) {
  const path = usePathname() || "/";
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-shell">
      {/* Lien d'évitement : premier élément focusable, visible uniquement au
          clavier — saute le rail et la topbar (WCAG 2.4.1). */}
      <a href="#main-content" className="skip-link">Aller au contenu</a>
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}

      <nav className="app-rail" aria-label="Navigation principale">
        <Link href="/" className="rail-logo" aria-label="Fox Prospect — accueil">
          <FoxMark size={34} />
        </Link>
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`app-rail-item${isActive(path, href) ? " active" : ""}`}
            title={label}
            aria-label={label}
            aria-current={isActive(path, href) ? "page" : undefined}
          >
            <Icon />
          </Link>
        ))}
        <Link
          href="/settings"
          className={`app-rail-item app-rail-spacer${isActive(path, "/settings") ? " active" : ""}`}
          title="Réglages"
          aria-label="Réglages"
          aria-current={isActive(path, "/settings") ? "page" : undefined}
        >
          <Settings24Regular />
        </Link>
      </nav>

      <div className="app-content">
        <OfflineBanner />
        <header className="app-topbar">
          <span className="app-mobile-brand">
            <FoxLogo size={30} />
          </span>
          <div
            className="app-search"
            role="button"
            tabIndex={0}
            aria-label="Rechercher"
            onClick={() => setShowSearch(true)}
            onKeyDown={e => {
              // Enter ET Espace : comportement standard d'un bouton (WCAG 2.1.1).
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowSearch(true);
              }
            }}
          >
            <Search24Regular />
            <span>Rechercher un compte, un contact…</span>
            <kbd>⌘K</kbd>
          </div>
          <div className="app-topbar-actions">
            <button
              className="app-iconbtn app-search-mobile"
              aria-label="Rechercher"
              title="Rechercher"
              onClick={() => setShowSearch(true)}
            >
              <Search24Regular />
            </button>
            <button
              className="app-iconbtn"
              aria-label="Activité"
              title="Activité récente"
              onClick={() => router.push("/analytics")}
            >
              <Alert24Regular />
            </button>
            <button
              className="app-iconbtn primary"
              aria-label="Importer des prospects"
              title="Importer des prospects"
              onClick={() => router.push("/import")}
            >
              <Add24Regular />
            </button>
          </div>
        </header>

        <main id="main-content" className="app-main">{children}</main>
      </div>

      <nav className="app-bottombar" aria-label="Navigation mobile">
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-label={label}
            aria-current={isActive(path, href) ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
        {/* Réglages : présent dans le rail desktop, il manquait sur mobile —
            l'offre et l'identité expéditeur étaient inaccessibles au téléphone. */}
        <Link href="/settings" className={isActive(path, "/settings") ? "active" : ""} aria-label="Réglages"
          aria-current={isActive(path, "/settings") ? "page" : undefined}>
          <Settings24Regular />
          <span>Réglages</span>
        </Link>
      </nav>
    </div>
  );
}
