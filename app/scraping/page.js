"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const KIND_LABELS = {
  discover: "Découvrir (noms + LinkedIn)",
  discover_and_enrich: "Découvrir + enrichir (email)",
  enrich: "Enrichir l'existant (email)",
};

const STATUS_PILL = {
  pending: { cls: "pill-nouveau", txt: "en attente" },
  running: { cls: "pill-contacte", txt: "en cours" },
  done: { cls: "pill-rdv", txt: "terminé" },
  error: { cls: "pill-optout", txt: "erreur" },
};

function StatusPill({ status }) {
  const s = STATUS_PILL[status] || STATUS_PILL.pending;
  return <span className={`pill ${s.cls}`}>{s.txt}</span>;
}

function ProgressBar({ value }) {
  return (
    <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", minWidth: 80 }}>
      <div style={{ width: `${value || 0}%`, height: "100%", background: "var(--fox)", transition: "width 0.4s ease" }} />
    </div>
  );
}

export default function ScrapingPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null); // { job, results }
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Formulaire
  const [accountId, setAccountId] = useState("");
  const [company, setCompany] = useState("");
  const [kind, setKind] = useState("discover_and_enrich");
  const [limit, setLimit] = useState(8);
  const [launching, setLaunching] = useState(false);

  const [qualifying, setQualifying] = useState(null); // id du résultat en cours
  const pollRef = useRef(null);

  const loadJobs = async () => {
    const res = await fetch("/api/scrape/jobs");
    const d = await res.json().catch(() => ({}));
    if (!d.error) setJobs(d.jobs || []);
    return d.jobs || [];
  };

  const loadSelected = async (id) => {
    const res = await fetch(`/api/scrape/jobs/${id}`);
    const d = await res.json().catch(() => ({}));
    if (!d.error) setSelected(d);
  };

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {});
    loadJobs();
  }, []);

  // Polling 5 s tant qu'un job tourne (ou est en attente).
  useEffect(() => {
    const active = jobs.some((j) => j.status === "running" || j.status === "pending");
    if (active && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        await loadJobs();
        if (selected?.job?.id) await loadSelected(selected.job.id);
      }, 5000);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current && !active) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [jobs, selected]);

  const launch = async () => {
    setError(""); setInfo("");
    if (!accountId && !company.trim()) { setError("Choisis un compte ou saisis une entreprise."); return; }
    setLaunching(true);
    const res = await fetch("/api/scrape/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_id: accountId || null, company: company.trim(), kind, limit: Number(limit) }),
    });
    const d = await res.json().catch(() => ({}));
    setLaunching(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    setInfo(d.dispatched
      ? "Job lancé — le worker démarre dans quelques secondes."
      : "Job mis en file — il sera traité au prochain passage du cron (PAT GitHub non configuré).");
    await loadJobs();
    if (d.job?.id) loadSelected(d.job.id);
  };

  // Promotion + qualification 2 passes (réutilise /api/research existant).
  const qualifyOne = async (result) => {
    setQualifying(result.id); setError(""); setInfo("");
    try {
      const pr = await fetch("/api/scrape/promote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ result_id: result.id }),
      });
      const pd = await pr.json().catch(() => ({}));
      if (!pr.ok) { setError(pd.error || "Promotion impossible."); return false; }
      const prospectId = pd.prospect?.id || pd.prospect_id;
      const rr = await fetch("/api/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId }),
      });
      if (rr.status === 429) { setError("Plafond quotidien de recherches atteint — qualification reprise demain."); return false; }
      return true;
    } finally {
      setQualifying(null);
      if (selected?.job?.id) loadSelected(selected.job.id);
    }
  };

  const qualifyAll = async () => {
    const todo = (selected?.results || []).filter((r) => !r.prospect_id);
    for (const r of todo) {
      const ok = await qualifyOne(r);
      if (!ok) break; // 429 / erreur → on s'arrête (respect du cap)
    }
    setInfo("Qualification en lot terminée (ou stoppée au plafond).");
  };

  return (
    <>
      <h1>Scraping</h1>
      <p className="sub">Découverte de décideurs + enrichissement, exécutés par le worker GitHub Actions. Progression en direct.</p>

      {error && <div className="alert alert-err">{error}</div>}
      {info && <div className="alert alert-ok">{info}</div>}

      {/* ── Lancer ──────────────────────────────────────────────────────────── */}
      <div className="card">
        <h2>Lancer un scraping</h2>
        <div className="grid2">
          <div>
            <label>Compte cible</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— saisie libre ci-dessous —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label>…ou entreprise (texte)</label>
            <input placeholder="ex. Decathlon" value={company} onChange={(e) => setCompany(e.target.value)} disabled={!!accountId} />
          </div>
          <div>
            <label>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label>Profils max</label>
            <input type="number" min="1" max="20" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn-fox" disabled={launching} onClick={launch}>
            {launching && <span className="spin" />}
            Lancer
          </button>
        </div>
      </div>

      {/* ── Jobs ────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px 8px" }}><h2 style={{ margin: 0 }}>Jobs</h2></div>
        {jobs.length === 0 && <p className="sub small" style={{ padding: "0 20px 18px" }}>Aucun job pour l'instant.</p>}
        {jobs.length > 0 && (
          <table>
            <thead>
              <tr><th>Cible</th><th>Type</th><th>Statut</th><th>Progression</th><th>Résultats</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const st = j.stats || {};
                return (
                  <tr key={j.id} className="clickable" onClick={() => loadSelected(j.id)}>
                    <td><strong>{j.params?.company || j.params?.account_id || "—"}</strong></td>
                    <td className="sub small">{KIND_LABELS[j.kind] || j.kind}</td>
                    <td><StatusPill status={j.status} /></td>
                    <td><ProgressBar value={j.progress} /></td>
                    <td className="sub small">
                      {st.found ?? 0} trouvé{(st.found ?? 0) > 1 ? "s" : ""}
                      {st.enriched ? ` · ${st.enriched} email` : ""}
                      {st.blocked ? ` · ${st.blocked} bloqué` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Résultats du job sélectionné ────────────────────────────────────── */}
      {selected?.job && (
        <div className="card" style={{ padding: 0 }}>
          <div className="row spread" style={{ padding: "16px 20px 8px" }}>
            <h2 style={{ margin: 0 }}>
              Résultats — {selected.job.params?.company || selected.job.params?.account_id}
            </h2>
            {(selected.results || []).some((r) => !r.prospect_id) && (
              <button onClick={qualifyAll} disabled={!!qualifying}>Tout qualifier</button>
            )}
          </div>
          {selected.job.error && <div className="alert alert-err" style={{ margin: "0 20px 12px" }}>{selected.job.error}</div>}
          {(selected.results || []).length === 0 && (
            <p className="sub small" style={{ padding: "0 20px 18px" }}>
              {selected.job.status === "running" ? "En cours…" : "Aucun contact (source bloquée ou rien trouvé)."}
            </p>
          )}
          {(selected.results || []).length > 0 && (
            <table>
              <thead>
                <tr><th>Nom</th><th>Poste</th><th>Email</th><th>Source</th><th></th></tr>
              </thead>
              <tbody>
                {selected.results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.full_name || "—"}</strong>
                      {r.linkedin_url && <> · <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="sub small">LinkedIn</a></>}
                    </td>
                    <td className="sub small">{r.title || "—"}</td>
                    <td className="sub small">
                      {r.email
                        ? <>{r.email} {r.email_confidence && <span className="relbadge rel-partiel">{r.email_confidence}</span>}</>
                        : "—"}
                    </td>
                    <td className="sub small">{r.source}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {r.prospect_id
                        ? <span className="sub small" style={{ color: "var(--ok)" }}>✓ qualifié</span>
                        : (
                          <button onClick={() => qualifyOne(r)} disabled={qualifying === r.id}>
                            {qualifying === r.id && <span className="spin spin-dark" />}
                            Qualifier
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
