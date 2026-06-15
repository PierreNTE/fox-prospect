"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STATUS_ORDER = ["nouveau", "recherché", "contacté", "répondu", "rdv", "opt-out"];
const STATUS_LABELS = {
  nouveau: "Nouveau",
  recherché: "Recherché",
  contacté: "Contacté",
  répondu: "Répondu",
  rdv: "RDV",
  "opt-out": "Opt-out",
};
const STATUS_COLORS = {
  nouveau: "var(--faint)",
  recherché: "#3498db",
  contacté: "var(--fox)",
  répondu: "#e67e22",
  rdv: "var(--ok)",
  "opt-out": "var(--bad)",
};
const EVENT_LABELS = {
  status_change: "Changement de statut",
  email_sent: "Email envoyé",
  call_made: "Appel",
  rdv_booked: "RDV programmé",
  reply_received: "Réponse reçue",
  note_added: "Note ajoutée",
  research_done: "Recherche effectuée",
  draft_generated: "Brouillon généré",
  auto_action: "Action automatique",
  signal_detected: "Signal détecté",
  enrich_done: "Enrichissement",
};
const ROUTE_LABELS = {
  research: "Recherche",
  generate: "Génération",
  enrich: "Enrichissement",
  "import-linkedin": "Import LinkedIn",
  "accounts/analyze": "Analyse compte",
};

function ScoreRing({ value, label }) {
  if (value == null) return <div style={{ textAlign: "center", color: "var(--faint)" }}>—</div>;
  const color = value >= 70 ? "var(--ok)" : value >= 40 ? "var(--fox)" : "var(--bad)";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 36, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div className="sub small" style={{ marginTop: 2 }}>{label}</div>
    </div>
  );
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "18px 14px" }}>
      <div style={{ fontSize: 30, fontWeight: 700, color: color || "var(--ink)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>{label}</div>
      {sub && <div className="sub small" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatusBar({ byStatus }) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="sub small">Aucun prospect.</div>;
  return (
    <div>
      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 18, marginBottom: 10 }}>
        {STATUS_ORDER.filter((s) => byStatus[s]).map((s) => (
          <div
            key={s}
            title={`${STATUS_LABELS[s] || s} : ${byStatus[s]}`}
            style={{ flex: byStatus[s], background: STATUS_COLORS[s] || "var(--faint)", minWidth: byStatus[s] ? 4 : 0 }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
        {STATUS_ORDER.filter((s) => byStatus[s]).map((s) => (
          <span key={s} style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_COLORS[s] || "var(--faint)", display: "inline-block" }} />
            <span style={{ color: "var(--muted)" }}>{STATUS_LABELS[s] || s}</span>
            <strong>{byStatus[s]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function CostBars({ data }) {
  const maxCost = Math.max(...data.map((d) => d.cost), 0.00001);
  const total = data.reduce((s, d) => s + d.cost, 0);
  if (total === 0) {
    return <div className="sub small" style={{ paddingTop: 16 }}>Aucun coût IA enregistré sur 30 jours.</div>;
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 72 }}>
        {data.map((d) => (
          <div
            key={d.day}
            title={`${d.day} : ${d.cost.toFixed(4)} €`}
            style={{
              flex: 1,
              background: d.cost > 0 ? "var(--fox)" : "var(--line)",
              opacity: d.cost > 0 ? 0.85 : 0.4,
              height: `${Math.max((d.cost / maxCost) * 100, d.cost > 0 ? 4 : 1)}%`,
              borderRadius: "2px 2px 0 0",
              transition: "height 0.3s ease",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span className="sub small">{data[0]?.day?.slice(5)}</span>
        <span className="sub small" style={{ color: "var(--fox-ink)", fontWeight: 600 }}>
          {total.toFixed(4)} € total
        </span>
        <span className="sub small">{data[data.length - 1]?.day?.slice(5)}</span>
      </div>
    </div>
  );
}

function HorizBars({ data, colorFn }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {data.map((d) => (
        <div key={d.key}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{d.label}</span>
            <strong style={{ fontSize: 13 }}>{d.value}</strong>
          </div>
          <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                width: `${(d.value / max) * 100}%`,
                height: "100%",
                background: colorFn ? colorFn(d.key) : "var(--fox)",
                borderRadius: 3,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Erreur de chargement."));
  }, []);

  const handleExport = () => {
    window.location.href = "/api/prospects/export?format=csv";
  };

  return (
    <>
      <div className="row spread" style={{ marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1>Analyse</h1>
          <p className="sub">Coûts IA · pipeline commercial · activité (30 derniers jours)</p>
        </div>
        <button onClick={handleExport} title="Télécharger tous les prospects en CSV">
          ↓ Exporter CSV
        </button>
      </div>

      {error && <div className="alert alert-err">{error}</div>}

      {!data && !error && (
        <div className="card">
          <span className="spin spin-dark" /> Chargement des données…
        </div>
      )}

      {data && (
        <>
          {/* ── KPIs résumés ────────────────────────────────────────────── */}
          <div className="grid2" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            <KpiCard
              label="Prospects"
              value={data.prospects.total}
              sub={`score moyen ${data.prospects.avg_fit_score ?? "—"}/100`}
            />
            <KpiCard
              label="Coût IA 30j"
              value={`${data.ai.total_cost_eur.toFixed(3)} €`}
              sub={`${data.ai.runs} appels · ${data.ai.web_searches} recherches web`}
              color="var(--fox-ink)"
            />
            <KpiCard
              label="Événements 30j"
              value={data.events.total}
              sub={`dont ${data.events.rdv_booked} RDV · ${data.events.research_done} rech.`}
            />
            <KpiCard
              label="Score fit récent"
              value={data.scores.avg_recent ?? "—"}
              sub={`sur ${data.scores.sample_size} analyse(s) récente(s)`}
              color={data.scores.avg_recent >= 70 ? "var(--ok)" : data.scores.avg_recent >= 40 ? "var(--fox)" : "var(--bad)"}
            />
          </div>

          {/* ── Pipeline prospects ───────────────────────────────────────── */}
          <div className="card">
            <h2>Répartition des prospects</h2>
            <StatusBar byStatus={data.prospects.by_status} />
          </div>

          {/* ── Coût IA par jour ─────────────────────────────────────────── */}
          <div className="card">
            <div className="row spread" style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Coûts IA — 30 derniers jours</h2>
              <span className="sub small">
                {(data.ai.tokens_in / 1000).toFixed(1)}k tokens in ·{" "}
                {(data.ai.tokens_out / 1000).toFixed(1)}k tokens out
              </span>
            </div>
            <CostBars data={data.ai.by_day} />
            {Object.keys(data.ai.by_route).length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="sub small" style={{ marginBottom: 10, fontWeight: 600 }}>Par route</div>
                <HorizBars
                  data={Object.entries(data.ai.by_route)
                    .sort(([, a], [, b]) => b - a)
                    .map(([key, value]) => ({
                      key,
                      label: ROUTE_LABELS[key] || key,
                      value: +value.toFixed(4),
                    }))}
                  colorFn={() => "var(--fox)"}
                />
              </div>
            )}
          </div>

          {/* ── Activité commerciale ─────────────────────────────────────── */}
          {Object.keys(data.events.by_kind).length > 0 && (
            <div className="card">
              <h2>Activité commerciale — 30 derniers jours</h2>
              <HorizBars
                data={Object.entries(data.events.by_kind)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, value]) => ({
                    key,
                    label: EVENT_LABELS[key] || key,
                    value,
                  }))}
                colorFn={(key) => (key === "rdv_booked" ? "var(--ok)" : key === "reply_received" ? "#3498db" : "var(--fox)")}
              />
            </div>
          )}
          {Object.keys(data.events.by_kind).length === 0 && (
            <div className="card">
              <h2>Activité commerciale</h2>
              <p className="sub small">
                Aucun événement enregistré pour l'instant. Les événements s'alimentent automatiquement : changements de statut, recherches, génération de brouillons.
              </p>
            </div>
          )}

          {/* ── Export ───────────────────────────────────────────────────── */}
          <div className="card">
            <div className="row spread">
              <div>
                <h2 style={{ margin: 0 }}>Export CRM</h2>
                <p className="sub small" style={{ marginTop: 4, marginBottom: 0 }}>
                  Tous les prospects avec leur dernier score et résumé de recherche — prêt pour Pipedrive, HubSpot, ou un tableur.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleExport}>↓ CSV</button>
                <button onClick={() => window.open("/api/prospects/export?format=json", "_blank")}>
                  ↓ JSON
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
