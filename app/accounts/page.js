"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function HeatBadge({ score }) {
  if (score === null || score === undefined) return null;
  const color = score >= 70 ? "var(--accent)" : score >= 40 ? "#e67e22" : "var(--text-3)";
  return (
    <span style={{ fontWeight: 700, color, fontSize: 13, minWidth: 28, display: "inline-block" }}>
      {score}
    </span>
  );
}

function HotAccountCard({ account, onClick }) {
  const topSignal = account.signals?.[0];
  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: "pointer", padding: "12px 16px", marginBottom: 0 }}
    >
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HeatBadge score={account.heat_score} />
            <strong style={{ fontSize: 14 }}>{account.name}</strong>
            {account.sector && <span className="sub small">{account.sector}</span>}
          </div>
          {topSignal && (
            <p className="sub small" style={{ marginTop: 4, marginBottom: 0 }}>
              <span style={{ textTransform: "capitalize" }}>{topSignal.type}</span>
              {" · "}{topSignal.detail?.slice(0, 80)}{topSignal.detail?.length > 80 ? "…" : ""}
              {topSignal.date && <> · <em>{topSignal.date}</em></>}
            </p>
          )}
        </div>
        {account.signals_count > 0 && (
          <span className="sub small" style={{ marginLeft: 8, whiteSpace: "nowrap" }}>
            {account.signals_count} signal{account.signals_count > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState(null);
  const [hotAccounts, setHotAccounts] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [batch, setBatch] = useState(null);
  const [queuing, setQueuing] = useState(false);
  const [queuedMsg, setQueuedMsg] = useState("");
  const stopRef = useRef(false);

  // ── Import SIREN ────────────────────────────────────────────────────────
  const [sireneTotal, setSireneTotal] = useState(null);
  const [sirenePage, setSirenePage] = useState(1);
  const [sireneImporting, setSireneImporting] = useState(false);
  const [sireneResult, setSireneResult] = useState(null);
  const [sireneHasMore, setSireneHasMore] = useState(true);

  const load = async () => {
    const res = await fetch("/api/accounts");
    const d = await res.json();
    if (d.error) setError(d.error);
    else setAccounts(d.accounts);
    return d.accounts || [];
  };

  const loadHot = async () => {
    const res = await fetch("/api/accounts/heat?limit=8");
    const d = await res.json();
    if (!d.error) setHotAccounts(d.accounts || []);
  };

  const loadSireneTotal = async () => {
    const res = await fetch("/api/companies/import").catch(() => null);
    if (!res?.ok) return;
    const d = await res.json().catch(() => ({}));
    if (d.total !== undefined) setSireneTotal(d.total);
  };

  useEffect(() => {
    load();
    loadHot();
    loadSireneTotal();
  }, []);

  const importSirene = async () => {
    setSireneImporting(true);
    setSireneResult(null);
    const res = await fetch("/api/companies/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categories: ["ETI", "GE"], page: sirenePage, per_page: 25 }),
    });
    const d = await res.json().catch(() => ({}));
    setSireneImporting(false);
    if (d.error) { setError(d.error); return; }
    setSireneResult(d);
    setSirenePage(d.next_page || sirenePage + 1);
    setSireneHasMore(d.has_more ?? false);
    setSireneTotal((t) => (t ?? 0) + (d.imported || 0));
  };

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
    await loadHot();
  };

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
            message: `Plafond quotidien atteint après ${done} analyse(s). La recherche reprendra demain.` });
          return;
        }
        if (res.ok) done++;
      } catch {
        // continue malgré une erreur ponctuelle
      }
      await load();
      setBatch((b) => ({ ...b, done }));
    }
    await loadHot();
    setBatch((b) => ({ ...b, currentId: null, currentName: null, message: `Terminé : ${done}/${queue.length} comptes analysés.` }));
  };

  const stopBatch = () => { stopRef.current = true; };

  // Enfile tous les comptes non analysés dans la file de jobs — sans garder l'onglet ouvert.
  const enqueueAll = async () => {
    const all = await load();
    const pending = all.filter((a) => !a.last_refreshed_at);
    if (pending.length === 0) { setQueuedMsg("Tous les comptes ont déjà été analysés."); return; }
    setQueuing(true); setQueuedMsg("");
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "analyze_account", items: pending.map((a) => ({ account_id: a.id })) }),
    });
    const d = await res.json().catch(() => ({}));
    setQueuing(false);
    if (d.error) { setError(d.error); return; }
    setQueuedMsg(`${d.enqueued} compte(s) planifié(s) — le cron les analysera à 5h du matin (ou déclenche /api/cron/process-jobs manuellement).`);
  };

  const filtered = (accounts || []).filter((a) =>
    a.name.toLowerCase().includes(q.toLowerCase()) || (a.sector || "").toLowerCase().includes(q.toLowerCase())
  );
  const notAnalyzed = (accounts || []).filter((a) => !a.last_refreshed_at).length;
  const running = batch && batch.currentId;

  const hotVisible = hotAccounts && hotAccounts.filter((a) => a.heat_score > 0).length > 0;

  return (
    <>
      <h1>Comptes</h1>
      <p className="sub">Tes grands comptes : cartographie de l'organisation IT, actualités et signaux stratégiques par entreprise.</p>

      {error && <div className="alert alert-err">{error}</div>}

      {/* ── Dashboard comptes chauds ──────────────────────────────────────── */}
      {hotVisible && (
        <div className="card">
          <h2>Comptes chauds</h2>
          <p className="sub small" style={{ marginBottom: 12 }}>
            Triés par chaleur des signaux (score d'urgence avec décroissance temporelle).
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {hotAccounts.filter((a) => a.heat_score > 0).map((a) => (
              <HotAccountCard
                key={a.id}
                account={a}
                onClick={() => router.push(`/accounts/${a.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Créer / Importer ──────────────────────────────────────────────── */}
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

      {/* ── Recherche en lot ──────────────────────────────────────────────── */}
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
            <>
              <p className="sub small">
                <strong>Option A (onglet ouvert) :</strong> analyse immédiate, progression visible ci-dessus.<br />
                <strong>Option B (tâche de fond) :</strong> planifie les comptes dans la file — tu peux fermer l'onglet, le cron traitera à 5h.
              </p>
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={enqueueAll} disabled={queuing || notAnalyzed === 0}>
                  {queuing && <span className="spin spin-dark" />}
                  Planifier {notAnalyzed} compte(s) en tâche de fond
                </button>
              </div>
              {queuedMsg && <p className="sub small" style={{ marginTop: 8, color: "var(--accent)" }}>{queuedMsg}</p>}
            </>
          )}
        </div>
      )}

      {/* ── Base entreprises SIRENE ──────────────────────────────────────── */}
      <div className="card">
        <div className="row spread">
          <div>
            <h2>Base entreprises SIRENE</h2>
            <p className="sub small" style={{ marginBottom: 0 }}>
              Importe ETI et grandes entreprises depuis l'API officielle INSEE/SIRENE.
              Alimente les firmographiques (NAF, effectif, région) pour le scoring.
              {sireneTotal !== null && (
                <> · <strong>{sireneTotal.toLocaleString("fr-FR")}</strong> société(s) déjà en base.</>
              )}
            </p>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 10 }}>
          <button
            className="btn-fox"
            disabled={sireneImporting || !sireneHasMore}
            onClick={importSirene}
          >
            {sireneImporting && <span className="spin" />}
            {sireneHasMore
              ? `Importer la page ${sirenePage} (25 entreprises)`
              : "Import terminé"}
          </button>
          {sireneResult && !sireneImporting && (
            <span className="sub small" style={{ alignSelf: "center" }}>
              {sireneResult.imported} importée(s) · {sireneResult.skipped} ignorée(s)
              {sireneResult.has_more
                ? ` · page ${sireneResult.page}/${Math.ceil(sireneResult.total_results / 25)}`
                : " · fin de liste"}
            </span>
          )}
        </div>
      </div>

      {/* ── Liste complète ────────────────────────────────────────────────── */}
      {accounts && accounts.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "14px 16px 0" }}>
            <input placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <table>
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Secteur</th>
                <th style={{ textAlign: "right" }}>Chaleur</th>
                <th>Signaux</th>
                <th>Dernière veille</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const hot = hotAccounts?.find((h) => h.id === a.id);
                return (
                  <tr key={a.id} className="clickable" onClick={() => router.push(`/accounts/${a.id}`)}>
                    <td>
                      <strong>{a.name}</strong>
                      {batch && batch.currentId === a.id && <span className="spin spin-dark" style={{ marginLeft: 8 }} />}
                    </td>
                    <td className="sub">{a.sector || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {hot ? <HeatBadge score={hot.heat_score} /> : "—"}
                    </td>
                    <td>{(a.signals || []).length || "—"}</td>
                    <td className="sub small">
                      {a.last_refreshed_at ? new Date(a.last_refreshed_at).toLocaleDateString("fr-FR") : "en attente"}
                    </td>
                  </tr>
                );
              })}
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
