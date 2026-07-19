"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search24Regular,
  Person24Regular,
  BuildingMultiple24Regular,
  ContactCard24Regular,
} from "@fluentui/react-icons";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";

export default function SearchModal({ onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const router = useRouter();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null); setError(""); setLoading(false);
      return;
    }
    const t = setTimeout(async () => {
      // Annule la requête précédente : deux réponses lentes ne peuvent plus
      // revenir dans le désordre et afficher les résultats d'une vieille frappe.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      const { ok, data, error: err } = await fetchJson(
        `/api/search?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (!ok) setError(err);
      else { setError(""); setResults(data); setSelected(0); }
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const go = useCallback((url) => { onClose(); router.push(url); }, [onClose, router]);

  // Liste aplatie (prospects → contacts d'organigramme → comptes) pour la
  // navigation clavier : un seul index, les groupes ne sont que visuels.
  const items = useMemo(() => {
    if (!results) return [];
    return [
      ...(results.prospects || []).map((p) => ({
        key: `p-${p.id}`, url: `/prospects/${p.id}`, group: "Prospects", Icon: Person24Regular,
        name: `${p.first_name} ${p.last_name}`,
        sub: [p.role, p.company].filter(Boolean).join(" · "),
      })),
      ...(results.contacts || []).map((c) => ({
        key: `c-${c.id}`, url: `/accounts/${c.account_id}`, group: "Contacts", Icon: ContactCard24Regular,
        name: `${c.first_name} ${c.last_name}`,
        sub: [c.role, c.accounts?.name].filter(Boolean).join(" · "),
      })),
      ...(results.accounts || []).map((a) => ({
        key: `a-${a.id}`, url: `/accounts/${a.id}`, group: "Comptes", Icon: BuildingMultiple24Regular,
        name: a.name, sub: a.domain,
      })),
    ];
  }, [results]);

  const sel = items.length ? Math.min(selected, items.length - 1) : 0;

  useEffect(() => {
    document.getElementById(`search-opt-${sel}`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, Math.max(items.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && items.length) { e.preventDefault(); go(items[sel].url); }
    else if (e.key === "Tab") e.preventDefault(); // focus trap : tout se pilote depuis l'input
  };

  const noResults = results && items.length === 0;

  // Groupes rendus en séquence : on affiche l'en-tête quand il change.
  let lastGroup = null;

  return (
    <div
      className="search-overlay"
      onClick={onClose}
      onKeyDown={e => e.key === "Escape" && onClose()}
    >
      <div
        className="search-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Recherche"
      >
        <div className="search-modal-input">
          <Search24Regular />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher un prospect, un contact, un compte…"
            aria-label="Rechercher un prospect, un contact ou un compte"
            aria-controls="search-results"
            aria-activedescendant={items.length ? `search-opt-${sel}` : undefined}
            onKeyDown={onKeyDown}
          />
        </div>

        {error && (
          <div className="search-modal-state" role="alert" style={{ color: "var(--colorPaletteRedForeground1, #C50F1F)" }}>
            Recherche indisponible : {error}
          </div>
        )}
        {!error && loading && !results && <div className="search-modal-state">Recherche…</div>}
        {!error && !loading && noResults && (
          <div className="search-modal-state" role="status">Aucun résultat pour « {query} »</div>
        )}
        {!error && !results && !loading && (
          <div className="search-modal-state search-modal-hint">
            Tapez pour rechercher parmi vos prospects, contacts et comptes
          </div>
        )}

        {!error && results && items.length > 0 && (
          <div
            className="search-modal-results"
            id="search-results"
            role="listbox"
            aria-label="Résultats de recherche"
            // Résultats précédents conservés pendant le chargement (plus de
            // clignotement à chaque frappe) — juste atténués.
            style={loading ? { opacity: 0.55 } : undefined}
          >
            {items.map((it, i) => {
              const header = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              const Icon = it.Icon;
              return (
                <div key={it.key}>
                  {header && <div className="search-modal-group">{header}</div>}
                  <button
                    id={`search-opt-${i}`}
                    role="option"
                    aria-selected={i === sel}
                    className={`search-modal-item${i === sel ? " active" : ""}`}
                    onClick={() => go(it.url)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <Icon />
                    <span className="search-modal-item-name">{it.name}</span>
                    <span className="search-modal-item-sub">{it.sub}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
