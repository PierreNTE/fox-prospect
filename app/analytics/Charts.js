"use client";

// Graphiques recharts isolés dans un chunk séparé, chargé à la demande via
// next/dynamic depuis la page analytics. Sort ~100 Ko (recharts + d3) du bundle
// initial : la page (KPIs) s'affiche tout de suite, les graphes arrivent ensuite.

import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { Caption1 } from "@fluentui/react-components";
import { eur } from "@/lib/format";
import { STATUS_ORDER, STATUS_LABELS } from "@/lib/constants";

const BRAND = "#5B53E6";
const AMBER = "#F6A623";
const GREEN = "#107C10";
const RED = "#C50F1F";
const BLUE = "#0078D4";

const STATUS_COLORS = {
  non_contacte: "#8079EF",
  contacte: BLUE,
  en_cours: AMBER,
  interesse: "#E8730C",
  refuse: RED,
  client: GREEN,
};

const EVENT_LABELS = {
  interaction: "Interaction",
  opt_out: "Opposition",
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

export function PipelineDonut({ byStatus }) {
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

export function CostAreaChart({ byDay }) {
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
        <YAxis tick={{ fontSize: 10, fill: "var(--colorNeutralForeground3)" }} tickLine={false} axisLine={false} tickFormatter={(v) => eur(v)} />
        <Tooltip formatter={(v) => [eur(v), "Coût"]} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        <Area type="monotone" dataKey="cost" stroke={BRAND} strokeWidth={2} fill="url(#costGrad)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RouteBarChart({ byRoute }) {
  const entries = Object.entries(byRoute).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;
  const data = entries.map(([key, value]) => ({ label: ROUTE_LABELS[key] || key, cost: +value.toFixed(4) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(60, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10, fill: "var(--colorNeutralForeground3)" }} tickLine={false} axisLine={false} tickFormatter={(v) => eur(v)} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: "var(--colorNeutralForeground2)" }} tickLine={false} axisLine={false} width={110} />
        <Tooltip formatter={(v) => [eur(v), "Coût"]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        <Bar dataKey="cost" fill={AMBER} radius={[0, 3, 3, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ActivityBars({ byKind }) {
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
