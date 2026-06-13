"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // État de la recherche en lot.
  const [batch, setBatch] = useState(null); // { total, done, currentId, currentName, queue:[{id,name}], message }
  const stopRef = useRef(false);

  const load = async () => {
    const res = await fetch("/api/accounts");
    const d = await res.json();
    if (d.error) setError(d.error);
    else setAccounts(d.accounts);
    return d.accounts || [];
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setError("");
    const res = await fetch("/api/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    router.push(`/accounts/${d.account.id}`);
  };

  const seed = async () => {
    setSeeding(true); setError("");
    const res = await fetch("/api/accounts/seed", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setSeeding(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    await load();
  };

  // Recherche en lot : analyse séquentielle des comptes non encore analysés,
  // avec progression visible. S'arrête proprement au plafond quotidien (429).
  const runBatch = async () => {
    const all = await load();
    const queue = all
      .filter((a) => !a.last_refreshed_at)
      .map((a) => ({ id: a.id, name: a.name }));
    if (queue.length === 0) {
      setBatch({ total: 0, done: 0, message: "Tous les comptes ont déjà été analysés au moins une fois." });
      return;
    }
    stopRef.current = false;
    setBatch({ total: queue.length, done: 0, queue, currentId: null, currentName: null, message: "" });

    let done = 0;
    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) {
        setBatch((b) => ({ ...b, currentId: null, currentName: null, message: `Arrêté. ${done}/${queue.length} analysés.` }));
        return;
      }
      const item = queue[i];
      setBatch((b) => ({ ...b, currentId: item.id, currentName: item.name, queue: queue.slice(i + 1) }));
      try {
        const res = await fetch("/api/accounts/analyze", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: item.id }),
        });
        if (res.status === 429) {
          await load();
          setBatch({ total: queue.length, done, currentId: null, currentName: null, queue: [],
            message: `Plafond quotidien atteint après ${done} analyse(s). La recherche reprendra demain (ou via la veille auto).` });
          return;
        }
        if (res.ok) done++;
      } catch {
        // on continue malgré une erreur ponctuelle sur un compte
      }
      await load();
      setBatch((b) => ({ ...b, done }));
    }
    setBatch((b) => ({ ...b, currentId: null, currentName: null, message: `Terminé : ${done}/${queue.length} comptes analysés.` }));
  };

  const stopBatch = () => { stopRef.current = true; };

  const filtered = (accounts || []).filter((a) =>
    a.name.toLowerCase().includes(q.toLowerCase()) || (a.sector || "").toLowerCase().includes(q.toLowerCase())
  );
  const notAnalyzed = (accounts || []).filter((a) => !a.last_refreshed_at).length;
  const running = batch && batch.currentId;

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
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={seed} disabled={seeding || !!running}>
            {seeding && <span className="spin spin-dark" />}
            Importer les grands comptes français
          </button>
          <span className="sub small">Ajoute ~50 grandes entreprises FR (sans les analyser).</span>
        </div>
      </div>

      {/* Recherche en lot */}
      {accounts && accounts.length > 0 && (
        <div className="card">
          <div className="row spread">
            <h2>Recherche en lot</h2>
            {!running && (
              <button className="btn-fox" onClick={runBatch} disabled={notAnalyzed === 0}>
                Analyser les {notAnalyzed} compte(s) en attente
              </button>
            )}
            {running && <button onClick={stopBatch}>Stopper</button>}
          </div>

          {batch && (
            <>
              {running && (
                <div className="batch-current">
                  <span className="spin spin-dark" />
                  <span>Analyse en cours : <strong>{batch.currentName}</strong></span>
                  <span className="sub small">{batch.done}/{batch.total}</span>
                </div>
              )}
              {batch.message && <p className="sub small" style={{ marginTop: 8 }}>{batch.message}</p>}
              {running && batch.queue && batch.queue.length > 0 && (
                <p className="sub small" style={{ marginTop: 8 }}>
                  À venir : {batch.queue.slice(0, 4).map((x) => x.name).join(", ")}
                  {batch.queue.length > 4 && ` … (+${batch.queue.length - 4})`}
                </p>
              )}
            </>
          )}
          {!batch && (
            <p className="sub small">
              Analyse une à une les entreprises pas encore traitées (recherche web : synthèse, actualités, signaux,
              cartographie). S'arrête au plafond quotidien et reprend ensuite. Laisse l'onglet ouvert pendant la recherche.
            </p>
          )}
        </div>
      )}

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
                  <td>
                    <strong>{a.name}</strong>
                    {batch && batch.currentId === a.id && <span className="spin spin-dark" style={{ marginLeft: 8 }} />}
                  </td>
                  <td className="sub">{a.sector || "—"}</td>
                  <td>{(a.signals || []).length || "—"}</td>
                  <td className="sub small">
                    {a.last_refreshed_at ? new Date(a.last_refreshed_at).toLocaleDateString("fr-FR") : "en attente"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {accounts && accounts.length === 0 && (
        <div className="card empty">
          <p>Aucun compte pour l'instant. Crée-en un, importe les grands comptes français ci-dessus, ou importe des prospects (leur entreprise crée le compte automatiquement).</p>
        </div>
      )}
    </>
  );
}
