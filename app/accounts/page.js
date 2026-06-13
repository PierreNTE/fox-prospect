"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/accounts");
    const d = await res.json();
    if (d.error) setError(d.error);
    else setAccounts(d.accounts);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    router.push(`/accounts/${d.account.id}`);
  };

  const filtered = (accounts || []).filter((a) =>
    a.name.toLowerCase().includes(q.toLowerCase()) || (a.sector || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <h1>Comptes</h1>
      <p className="sub">Tes grands comptes : cartographie de l'organisation IT, actualités et signaux stratégiques par entreprise.</p>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="card">
        <h2>Analyser un nouveau compte</h2>
        <div className="row">
          <input
            placeholder="Nom de l'entreprise (ex. Coopérative U)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="btn-fox" disabled={busy || !name.trim()} onClick={create}>
            {busy && <span className="spin" />}
            Créer le compte
          </button>
        </div>
        <p className="sub small" style={{ marginTop: 8 }}>
          Le compte est créé vide ; tu lances l'analyse depuis sa fiche.
        </p>
      </div>

      {accounts && accounts.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "14px 16px 0" }}>
            <input placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <table>
            <thead>
              <tr><th>Entreprise</th><th>Secteur</th><th>Signaux</th><th>Dernière veille</th></tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => router.push(`/accounts/${a.id}`)}>
                  <td><strong>{a.name}</strong></td>
                  <td className="sub">{a.sector || "—"}</td>
                  <td>{(a.signals || []).length || "—"}</td>
                  <td className="sub small">
                    {a.last_refreshed_at ? new Date(a.last_refreshed_at).toLocaleDateString("fr-FR") : "jamais"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {accounts && accounts.length === 0 && (
        <div className="card empty">
          <p>Aucun compte pour l'instant. Crée-en un ci-dessus, ou importe des prospects (leur entreprise crée le compte automatiquement).</p>
        </div>
      )}
    </>
  );
}
