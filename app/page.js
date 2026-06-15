"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["nouveau", "recherché", "contacté", "répondu", "rdv", "perdu", "opt-out"];
const SORT_OPTIONS = [
  { value: "recent", label: "Récents d'abord" },
  { value: "score", label: "Score ↓" },
  { value: "name", label: "Nom A → Z" },
  { value: "company", label: "Entreprise A → Z" },
];

const NBA_COLORS = {
  prepare_rdv: "#27ae60", confirm_rdv: "#27ae60",
  relance_urgente: "#c0392b", relance: "#e67e22",
  generer: "var(--accent)", enrichir: "#8e44ad",
  envoyer: "var(--accent)", rechercher: "var(--accent)",
  opt_out: "var(--text-3)", archive: "var(--text-3)",
};

function ScoreBadge({ score }) {
  if (score == null) return <span className="score score-none">—</span>;
  const cls = score >= 70 ? "score-high" : score >= 40 ? "score-mid" : "score-low";
  return <span className={`score ${cls}`}>{score}</span>;
}

function NbaChip({ nba }) {
  const color = NBA_COLORS[nba.action] || "var(--accent)";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 12,
        background: color,
        color: "#fff",
        whiteSpace: "nowrap",
      }}
    >
      {nba.label}
    </span>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [prospects, setProspects] = useState(null);
  const [priorities, setPriorities] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("tous");
  const [sortBy, setSortBy] = useState("recent");
  const [minScore, setMinScore] = useState(0);
  const [showPriorities, setShowPriorities] = useState(true);

  const load = async () => {
    const res = await fetch("/api/prospects");
    const data = await res.json();
    if (data.error) setError(data.error);
    else setProspects(data.prospects);
  };

  const loadPriorities = async () => {
    const res = await fetch("/api/prospects/priorities").catch(() => null);
    if (!res?.ok) return;
    const d = await res.json().catch(() => ({}));
    if (d.priorities) setPriorities(d.priorities);
  };

  useEffect(() => {
    load();
    loadPriorities();
  }, []);

  const setStatus = async (id, status) => {
    if (
      status === "opt-out" &&
      !confirm("Inscrire ce contact en opposition permanente ? Il ne pourra plus jamais être importé.")
    ) return;
    setError("");
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) setError(data.error || `Erreur ${res.status}.`);
    load();
    loadPriorities();
  };

  const counts = useMemo(() => {
    const c = { tous: 0 };
    for (const s of STATUSES) c[s] = 0;
    (prospects || []).forEach((p) => {
      c[p.status] = (c[p.status] || 0) + 1;
      c.tous++;
    });
    return c;
  }, [prospects]);

  const filtered = useMemo(() => {
    let list = prospects || [];
    if (q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(lq) ||
          (p.company || "").toLowerCase().includes(lq) ||
          (p.role || "").toLowerCase().includes(lq)
      );
    }
    if (filterStatus !== "tous") list = list.filter((p) => p.status === filterStatus);
    if (minScore > 0) list = list.filter((p) => (p.fit_score || 0) >= minScore);
    const sorted = [...list];
    if (sortBy === "score") sorted.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
    else if (sortBy === "name")
      sorted.sort((a, b) =>
        `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr")
      );
    else if (sortBy === "company")
      sorted.sort((a, b) => (a.company || "").localeCompare(b.company || "", "fr"));
    return sorted;
  }, [prospects, q, filterStatus, sortBy, minScore]);

  const hasFilters = q.trim() || filterStatus !== "tous" || minScore > 0;
  const topPriorities = (priorities || []).filter((p) => p.nba.priority >= 50);

  return (
    <>
      <h1>La piste</h1>
      <p className="sub">
        Tes prospects, du sourcing au rendez-vous. Clique sur une ligne pour qualifier et générer les accroches.
      </p>

      {/* ── Funnel ── cliquable pour filtrer ─────────────────────────────── */}
      <div className="trail">
        {["nouveau", "recherché", "contacté", "répondu", "rdv"].map((s) => (
          <div
            key={s}
            className={`trail-step ${counts[s] > 0 ? "active" : ""}`}
            onClick={() => setFilterStatus(filterStatus === s ? "tous" : s)}
            style={{
              cursor: "pointer",
              outline: filterStatus === s ? "2px solid var(--accent)" : "none",
              outlineOffset: 2,
              borderRadius: 6,
            }}
          >
            <div className="n">{counts[s] ?? 0}</div>
            <div className="l">{s}</div>
          </div>
        ))}
      </div>

      {error && <div className="alert alert-err">{error}</div>}

      {/* ── Priorités du jour ─────────────────────────────────────────────── */}
      {topPriorities.length > 0 && (
        <div className="card" style={{ padding: "14px 16px" }}>
          <div className="row spread" style={{ marginBottom: showPriorities ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Priorités du jour</h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 12,
                  background: "var(--accent)",
                  color: "#fff",
                }}
              >
                {topPriorities.length}
              </span>
            </div>
            <button
              onClick={() => setShowPriorities((v) => !v)}
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              {showPriorities ? "Masquer" : "Afficher"}
            </button>
          </div>

          {showPriorities && topPriorities.slice(0, 6).map((p, i) => (
            <div
              key={p.id}
              className="row spread clickable"
              onClick={() => router.push(`/prospects/${p.id}`)}
              style={{
                padding: "9px 0",
                borderTop: i > 0 ? "1px solid var(--border)" : "none",
                cursor: "pointer",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>
                  {p.first_name} {p.last_name}
                </strong>
                <span className="sub small" style={{ marginLeft: 6 }}>
                  {p.company}
                </span>
                {p.nba.reason && (
                  <p className="sub small" style={{ margin: "2px 0 0", lineHeight: 1.3 }}>
                    {p.nba.reason}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <NbaChip nba={p.nba} />
                <ScoreBadge score={p.fit_score} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Liste complète avec filtres ───────────────────────────────────── */}
      <div className="card" style={{ padding: 0 }}>
        <div
          className="row"
          style={{
            padding: "12px 16px",
            gap: 8,
            flexWrap: "wrap",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <input
            placeholder="Rechercher par nom, entreprise, poste…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: "1 1 180px", minWidth: 150 }}
          />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: "auto" }}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={minScore}
            onChange={(e) => setMinScore(+e.target.value)}
            style={{ width: "auto" }}
          >
            <option value={0}>Tous les scores</option>
            <option value={70}>Score ≥ 70</option>
            <option value={40}>Score ≥ 40</option>
          </select>
          {hasFilters && (
            <button
              onClick={() => { setQ(""); setFilterStatus("tous"); setMinScore(0); }}
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              × Réinitialiser
            </button>
          )}
          <span className="sub small" style={{ whiteSpace: "nowrap", alignSelf: "center" }}>
            {filtered.length} / {(prospects || []).length}
          </span>
        </div>

        {prospects === null ? (
          <div className="empty">Chargement…</div>
        ) : prospects.length === 0 ? (
          <div className="empty">
            <p>Aucun prospect sur la piste pour l'instant.</p>
            <a className="btn btn-fox" href="/import">Importer mes premiers prospects</a>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty"><p>Aucun prospect ne correspond aux filtres actifs.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Poste</th>
                <th>Entreprise</th>
                <th
                  style={{ cursor: "pointer", userSelect: "none" }}
                  title="Trier par score"
                  onClick={() => setSortBy(sortBy === "score" ? "recent" : "score")}
                >
                  Fit {sortBy === "score" ? "▼" : ""}
                </th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="clickable" style={{ cursor: "pointer" }}>
                  <td onClick={() => router.push(`/prospects/${p.id}`)}>
                    <strong>{p.first_name} {p.last_name}</strong>
                  </td>
                  <td onClick={() => router.push(`/prospects/${p.id}`)} className="sub">
                    {p.role || "—"}
                  </td>
                  <td onClick={() => router.push(`/prospects/${p.id}`)}>{p.company}</td>
                  <td onClick={() => router.push(`/prospects/${p.id}`)}>
                    <ScoreBadge score={p.fit_score} />
                  </td>
                  <td>
                    <select
                      value={p.status}
                      onChange={(e) => setStatus(p.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: "auto", padding: "5px 8px" }}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
