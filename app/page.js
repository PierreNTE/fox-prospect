"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["nouveau", "recherché", "contacté", "répondu", "rdv", "perdu", "opt-out"];

function ScoreBadge({ score }) {
  if (score == null) return <span className="score score-none">—</span>;
  const cls = score >= 70 ? "score-high" : score >= 40 ? "score-mid" : "score-low";
  return <span className={`score ${cls}`}>{score}</span>;
}

export default function Dashboard() {
  const router = useRouter();
  const [prospects, setProspects] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/prospects");
    const data = await res.json();
    if (data.error) setError(data.error);
    else setProspects(data.prospects);
  };

  useEffect(() => { load(); }, []);

  const setStatus = async (id, status) => {
    if (status === "opt-out" && !confirm("Inscrire ce contact en opposition permanente ? Il ne pourra plus jamais être importé.")) return;
    setError("");
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) setError(data.error || `Erreur ${res.status} lors du changement de statut.`);
    load();
  };

  const counts = {};
  for (const s of STATUSES) counts[s] = 0;
  (prospects || []).forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });

  return (
    <>
      <h1>La piste</h1>
      <p className="sub">Tes prospects, du sourcing au rendez-vous. Clique sur une ligne pour qualifier et générer les accroches.</p>

      <div className="trail">
        {["nouveau", "recherché", "contacté", "répondu", "rdv"].map((s) => (
          <div key={s} className={`trail-step ${counts[s] > 0 ? "active" : ""}`}>
            <div className="n">{counts[s] ?? 0}</div>
            <div className="l">{s}</div>
          </div>
        ))}
      </div>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        {prospects === null ? (
          <div className="empty">Chargement…</div>
        ) : prospects.length === 0 ? (
          <div className="empty">
            <p>Aucun prospect sur la piste pour l'instant.</p>
            <a className="btn btn-fox" href="/import">Importer mes premiers prospects</a>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Poste</th>
                <th>Entreprise</th>
                <th>Fit</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id} className="clickable" style={{ cursor: "pointer" }}>
                  <td onClick={() => router.push(`/prospects/${p.id}`)}>
                    <strong>{p.first_name} {p.last_name}</strong>
                  </td>
                  <td onClick={() => router.push(`/prospects/${p.id}`)} className="sub">{p.role || "—"}</td>
                  <td onClick={() => router.push(`/prospects/${p.id}`)}>{p.company}</td>
                  <td onClick={() => router.push(`/prospects/${p.id}`)}><ScoreBadge score={p.fit_score} /></td>
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
