"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Search24Regular, Person24Regular, BuildingMultiple24Regular } from "@fluentui/react-icons";
import { useRouter } from "next/navigation";

export default function SearchModal({ onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const router = useRouter();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        setResults(await res.json());
      } catch {}
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const go = useCallback((url) => { onClose(); router.push(url); }, [onClose, router]);

  const noResults = results && results.prospects.length === 0 && results.accounts.length === 0;

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
        aria-label="Recherche"
      >
        <div className="search-modal-input">
          <Search24Regular />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher un prospect, un compte…"
            onKeyDown={e => e.key === "Escape" && onClose()}
          />
        </div>

        {loading && <div className="search-modal-state">Recherche…</div>}
        {!loading && noResults && (
          <div className="search-modal-state">Aucun résultat pour « {query} »</div>
        )}
        {!loading && !results && (
          <div className="search-modal-state search-modal-hint">
            Tapez pour rechercher parmi vos prospects et comptes
          </div>
        )}

        {!loading && results && (results.prospects.length > 0 || results.accounts.length > 0) && (
          <div className="search-modal-results">
            {results.prospects.length > 0 && (
              <section>
                <div className="search-modal-group">Prospects</div>
                {results.prospects.map(p => (
                  <button
                    key={p.id}
                    className="search-modal-item"
                    onClick={() => go(`/prospects/${p.id}`)}
                  >
                    <Person24Regular />
                    <span className="search-modal-item-name">
                      {p.first_name} {p.last_name}
                    </span>
                    <span className="search-modal-item-sub">
                      {p.role && `${p.role} · `}{p.company}
                    </span>
                  </button>
                ))}
              </section>
            )}
            {results.accounts.length > 0 && (
              <section>
                <div className="search-modal-group">Comptes</div>
                {results.accounts.map(a => (
                  <button
                    key={a.id}
                    className="search-modal-item"
                    onClick={() => go(`/accounts/${a.id}`)}
                  >
                    <BuildingMultiple24Regular />
                    <span className="search-modal-item-name">{a.name}</span>
                    <span className="search-modal-item-sub">{a.domain}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
