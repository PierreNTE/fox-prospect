"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { FoxMark, FoxLogo } from "@/components/FoxLogo";
import SearchModal from "@/components/SearchModal";
import {
  Board24Regular,
  BuildingMultiple24Regular,
  Globe24Regular,
  ArrowImport24Regular,
  DataTrending24Regular,
  Settings24Regular,
  Search24Regular,
  Add24Regular,
  Alert24Regular,
} from "@fluentui/react-icons";

const NAV = [
  { href: "/", label: "Piste", Icon: Board24Regular },
  { href: "/accounts", label: "Comptes", Icon: BuildingMultiple24Regular },
  { href: "/scraping", label: "Scraping", Icon: Globe24Regular },
  { href: "/import", label: "Importer", Icon: ArrowImport24Regular },
  { href: "/analytics", label: "Analyse", Icon: DataTrending24Regular },
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
          >
            <Icon />
          </Link>
        ))}
        <Link
          href="/settings"
          className={`app-rail-item app-rail-spacer${isActive(path, "/settings") ? " active" : ""}`}
          title="Réglages"
          aria-label="Réglages"
        >
          <Settings24Regular />
        </Link>
      </nav>

      <div className="app-content">
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
            onKeyDown={e => e.key === "Enter" && setShowSearch(true)}
          >
            <Search24Regular />
            <span>Rechercher un compte, un contact…</span>
            <kbd>⌘K</kbd>
          </div>
          <div className="app-topbar-actions">
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

        <main className="app-main">{children}</main>
      </div>

      <nav className="app-bottombar" aria-label="Navigation mobile">
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-label={label}>
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
