"use client";

import { useEffect, useState } from "react";
import {
  Card,
  Button,
  Spinner,
  Badge,
  Title2,
  Body1,
  Caption1,
} from "@fluentui/react-components";
import {
  ArrowDownload24Regular,
  DataTrending24Regular,
  PeopleCommunity24Regular,
  Money24Regular,
  CalendarLtr24Regular,
  StarEmphasis24Regular,
} from "@fluentui/react-icons";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* ── Constants ────────────────────────────────────────────────────────────── */

const BRAND = "#5B53E6";
const AMBER = "#F6A623";
const GREEN = "#107C10";
const RED = "#C50F1F";
const BLUE = "#0078D4";

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
  nouveau: "#8079EF",
  recherché: BLUE,
  contacté: AMBER,
  répondu: "#e67e22",
  rdv: GREEN,
  "opt-out": RED,
};

const EVENT_LABELS = {
  status_change: "Changement de statut",
  email_sent: "Email envoyé",
  call_made: "Appel",
  rdv_booked: "RDV programmé",
  reply_received: "Réponse reçue",
  note_added: "Note ajoutée",
  research_done: "Recherche IA",
  draft_generated: "Brouillon généré",
  auto_action: "Action automatique",
  signal_detected: "Signal détecté",
  enrich_done: "Enrichissement",
};

const ROUTE_LABELS = {
  research: "Recherche IA",
  generate: "Génération",
  enrich: "Enrichissement",
  "import-linkedin": "Import LinkedIn",
  "accounts/analyze": "Analyse compte",
};

/* ── Sub-components ──────────────────────────────────────────────────────── */

function KpiCard({ icon: Icon, label, value, sub, color, trend }) {
  const trendColor = trend === "up" ? GREEN : trend === "down" ? RED : "var(--colorNeutralForeground3)";
  const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "—";
  return (
    <Card style={{ padding: "20px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: color || BRAND, fontSize: 22, display: "flex" }}>
          {Icon && <Icon />}
        </span>
        <Caption1 style={{ color: "var(--colorNeutralForeground2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 11 }}>
          {label}
        </Caption1>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: color || "var(--colorNeutralForeground1)", lineHeight: 1 }}>
          {value}
        </span>
        {trend && (
          <span style={{ fontSize: 13, fontWeight: 600, color: trendColor }}>{trendArrow}</span>
        )}
      </div>
      {sub && <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{sub}</Caption1>}
    </Card>
  );
}

function PipelineDonut({ byStatus }) {
  const data = STATUS_ORDER
    .filter((s) => byStatus[s] > 0)
    .map((s) => ({ name: STATUS_LABELS[s], value: byStatus[s], color: STATUS_COLORS[s] }));

  if (data.length === 0) {
    return <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Aucun prospect.</Caption1>;
  }

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={2}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip formatter={(v, n) => [`${v} (${Math.round((v / total) * 100)}%)`, n]} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
        {data.map((d) => (
          <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "var(--colorNeutralForeground2)", flex: 1 }}>{d.name}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--colorNeutralForeground1)" }}>{d.value}</span>
            <span style={{ fontSize: 11, color: "var(--colorNeutralForeground3)", width: 36, textAlign: "right" }}>
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostAreaChart({ byDay }) {
  const total = byDay.reduce((s, d) => s + d.cost, 0);
  if (total === 0) {
    return (
      <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", paddingTop: 12 }}>
        Aucun coût IA enregistré sur 30 jours.
      </Caption1>
    );
  }
  const data = byDay.map((d) => ({ day: d.day.slice(5), cost: +d.cost.toFixed(5) }));
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={BRAND} stopOpacity={0.25} />
            <stop offset="95%" stopColor={BRAND} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--colorNeutralForeground3)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: "var(--colorNeutralForeground3)" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v.toFixed(3)}€`} />
        <Tooltip formatter={(v) => [`${v.toFixed(5)} €`, "Coût"]} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        <Area type="monotone" dataKey="cost" stroke={BRAND} strokeWidth={2} fill="url(#costGrad)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RouteBarChart({ byRoute }) {
  const entries = Object.entries(byRoute).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;
  const data = entries.map(([key, value]) => ({ label: ROUTE_LABELS[key] || key, cost: +value.toFixed(4) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(60, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10, fill: "var(--colorNeutralForeground3)" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v.toFixed(3)}€`} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: "var(--colorNeutralForeground2)" }} tickLine={false} axisLine={false} width={110} />
        <Tooltip formatter={(v) => [`${v.toFixed(5)} €`, "Coût"]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        <Bar dataKey="cost" fill={AMBER} radius={[0, 3, 3, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ActivityBars({ byKind }) {
  const entries = Object.entries(byKind).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;
  const data = entries.map(([key, value]) => ({
    label: EVENT_LABELS[key] || key,
    value,
    fill: key === "rdv_booked" ? GREEN : key === "reply_received" ? BLUE : key === "research_done" ? BRAND : AMBER,
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(60, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "var(--colorNeutralForeground3)" }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: "var(--colorNeutralForeground2)" }} tickLine={false} axisLine={false} width={150} />
        <Tooltip formatter={(v) => [v, "Événements"]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Erreur de chargement."));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title2>Analyse</Title2>
          <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
            Coûts IA · pipeline commercial · activité — 30 derniers jours
          </Body1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            appearance="outline"
            icon={<ArrowDownload24Regular />}
            onClick={() => { window.location.href = "/api/prospects/export?format=csv"; }}
          >
            CSV
          </Button>
          <Button
            appearance="outline"
            icon={<ArrowDownload24Regular />}
            onClick={() => window.open("/api/prospects/export?format=json", "_blank")}
          >
            JSON
          </Button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── Loading ── */}
      {!data && !error && (
        <Card style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Spinner size="small" />
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>Chargement des données…</Body1>
        </Card>
      )}

      {data && (
        <>
          {/* ── KPI cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <KpiCard
              icon={PeopleCommunity24Regular}
              label="Prospects"
              value={data.prospects.total}
              sub={`score moyen ${data.prospects.avg_fit_score ?? "—"}/100`}
              color={BRAND}
            />
            <KpiCard
              icon={Money24Regular}
              label="Coût IA 30j"
              value={`${data.ai.total_cost_eur.toFixed(3)} €`}
              sub={`${data.ai.runs} appels · ${data.ai.web_searches} rech. web`}
              color={AMBER}
            />
            <KpiCard
              icon={CalendarLtr24Regular}
              label="Événements 30j"
              value={data.events.total}
              sub={`${data.events.rdv_booked} RDV · ${data.events.research_done} recherches`}
              color={GREEN}
            />
            <KpiCard
              icon={StarEmphasis24Regular}
              label="Score fit récent"
              value={data.scores.avg_recent ?? "—"}
              sub={`sur ${data.scores.sample_size} analyse(s)`}
              color={
                data.scores.avg_recent == null ? "var(--colorNeutralForeground3)"
                  : data.scores.avg_recent >= 70 ? GREEN
                  : data.scores.avg_recent >= 40 ? AMBER
                  : RED
              }
            />
          </div>

          {/* ── Pipeline donut ── */}
          <Card style={{ padding: "20px 20px 24px" }}>
            <div style={{ marginBottom: 16 }}>
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Pipeline prospects</Body1>
            </div>
            <PipelineDonut byStatus={data.prospects.by_status} />
          </Card>

          {/* ── Coût IA + par route ── */}
          <Card style={{ padding: "20px 20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, flexWrap: "wrap", gap: 6 }}>
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Coûts IA — 30 jours</Body1>
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                {(data.ai.tokens_in / 1000).toFixed(1)}k in · {(data.ai.tokens_out / 1000).toFixed(1)}k out
              </Caption1>
            </div>
            <CostAreaChart byDay={data.ai.by_day} />
            {Object.keys(data.ai.by_route).length > 0 && (
              <>
                <div style={{ marginTop: 20, marginBottom: 10 }}>
                  <Caption1 style={{ fontWeight: 600, color: "var(--colorNeutralForeground2)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 11 }}>
                    Répartition par route
                  </Caption1>
                </div>
                <RouteBarChart byRoute={data.ai.by_route} />
              </>
            )}
          </Card>

          {/* ── Activité commerciale ── */}
          <Card style={{ padding: "20px 20px 24px" }}>
            <div style={{ marginBottom: 16 }}>
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Activité commerciale — 30 jours</Body1>
            </div>
            {Object.keys(data.events.by_kind).length > 0 ? (
              <ActivityBars byKind={data.events.by_kind} />
            ) : (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                Aucun événement enregistré. Les événements s'alimentent automatiquement : changements de statut, recherches, génération de brouillons.
              </Caption1>
            )}
          </Card>

          {/* ── Tokens détail ── */}
          <Card style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <DataTrending24Regular style={{ color: BRAND }} />
              <Body1 style={{ fontWeight: 600 }}>Utilisation tokens</Body1>
              <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                <Badge appearance="filled" color="brand">{(data.ai.tokens_in / 1000).toFixed(1)}k entrée</Badge>
                <Badge appearance="filled" color="warning">{(data.ai.tokens_out / 1000).toFixed(1)}k sortie</Badge>
                <Badge appearance="filled" color="success">{data.ai.runs} appels</Badge>
                <Badge appearance="filled" color="informative">{data.ai.web_searches} recherches web</Badge>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
