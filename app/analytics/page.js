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
import dynamic from "next/dynamic";
import { eur } from "@/lib/format";

// Graphiques recharts chargés à la demande (sortis du bundle initial → la page
// s'affiche immédiatement, les graphes arrivent ensuite).
const PipelineDonut = dynamic(() => import("./Charts").then((m) => m.PipelineDonut), { ssr: false });
const CostAreaChart = dynamic(() => import("./Charts").then((m) => m.CostAreaChart), { ssr: false });
const RouteBarChart = dynamic(() => import("./Charts").then((m) => m.RouteBarChart), { ssr: false });
const ActivityBars = dynamic(() => import("./Charts").then((m) => m.ActivityBars), { ssr: false });

/* ── Constants ────────────────────────────────────────────────────────────── */

const BRAND = "#5B53E6";
const AMBER = "#F6A623";
const GREEN = "#107C10";
const RED = "#C50F1F";
const BLUE = "#0078D4";

// STATUS_COLORS / EVENT_LABELS / ROUTE_LABELS et les composants graphiques sont
// désormais dans ./Charts.js (chunk recharts chargé à la demande).

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

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/analytics", { cache: "no-store" })
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
              value={eur(data.ai.total_cost_eur)}
              sub={`${data.ai.runs} appels · ${data.ai.web_searches} rech. web`}
              color={AMBER}
            />
            <KpiCard
              icon={CalendarLtr24Regular}
              label="Événements 30j"
              value={data.events.total}
              sub={`${data.events.interactions} interactions · ${data.events.research_done} recherches`}
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
