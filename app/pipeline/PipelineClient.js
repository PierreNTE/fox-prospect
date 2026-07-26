"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Select, Title2, Body1, Caption1 } from "@fluentui/react-components";
import { fetchJson } from "@/lib/fetch-json";
import {
  OPP_OPEN_STAGES, OPP_STAGES, OPP_STAGE_LABEL, OPP_STAGE_COLOR,
  effectiveProbability, weightedAmount,
} from "@/lib/opportunities";

const RED = "#C50F1F";

function fmtEur(n) {
  const v = Number(n) || 0;
  if (!v) return "—";
  if (v >= 1000) return `${Math.round(v / 1000).toLocaleString("fr-FR")} k€`;
  return `${v.toLocaleString("fr-FR")} €`;
}

function Tile({ label, value, color }) {
  return (
    <div style={{ flex: "1 1 130px", minWidth: 118, padding: "12px 14px", borderRadius: 10, background: "var(--colorNeutralBackground1)", border: "1px solid var(--colorNeutralStroke2)" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginTop: 2, display: "block" }}>{label}</Caption1>
    </div>
  );
}

export default function PipelineClient({ initial }) {
  const router = useRouter();
  const [opps, setOpps] = useState(initial || []);
  const [error, setError] = useState("");

  const move = async (opp, stage) => {
    const before = opps;
    setOpps((list) => list.map((o) => (o.id === opp.id ? { ...o, stage } : o)));
    const { ok, error: err } = await fetchJson(`/api/opportunities/${opp.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!ok) { setError(err); setOpps(before); }
  };

  const open = opps.filter((o) => OPP_OPEN_STAGES.includes(o.stage));
  const won = opps.filter((o) => o.stage === "gagne");
  const forecast = open.reduce((s, o) => s + weightedAmount(o), 0);
  const gross = open.reduce((s, o) => s + (Number(o.amount_eur) || 0), 0);
  const wonTotal = won.reduce((s, o) => s + (Number(o.amount_eur) || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Title2>Pipeline</Title2>
        <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
          Tes affaires en cours, par étape. Crée une opportunité depuis une fiche compte.
        </Body1>
      </div>

      {error && <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}><Body1 style={{ color: RED }}>{error}</Body1></Card>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Tile label="Prévision pondérée" value={fmtEur(forecast)} color="#5B53E6" />
        <Tile label="Pipeline brut" value={fmtEur(gross)} color="#0078D4" />
        <Tile label="Affaires ouvertes" value={String(open.length)} color="#64748B" />
        <Tile label="Gagné" value={fmtEur(wonTotal)} color="#107C10" />
      </div>

      {open.length === 0 ? (
        <Card style={{ padding: "32px 24px", textAlign: "center" }}>
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>
            Aucune affaire ouverte. Ouvre une fiche compte pour créer ta première opportunité.
          </Body1>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
          {OPP_OPEN_STAGES.map((st) => {
            const col = open.filter((o) => o.stage === st);
            const colTotal = col.reduce((s, o) => s + (Number(o.amount_eur) || 0), 0);
            return (
              <div key={st}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: OPP_STAGE_COLOR[st] }} />
                  <Body1 style={{ fontWeight: 700, fontSize: 13 }}>{OPP_STAGE_LABEL[st]}</Body1>
                  <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginLeft: "auto" }}>{col.length} · {fmtEur(colTotal)}</Caption1>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {col.length === 0 && <Caption1 style={{ color: "var(--colorNeutralForeground4)" }}>—</Caption1>}
                  {col.map((o) => (
                    <Card key={o.id} style={{ padding: "12px 14px", borderLeft: `3px solid ${OPP_STAGE_COLOR[st]}` }}>
                      <Body1 style={{ fontWeight: 600, fontSize: 13, cursor: o.account_id ? "pointer" : "default" }}
                        onClick={() => o.account_id && router.push(`/accounts/${o.account_id}`)}>
                        {o.title}
                      </Body1>
                      {o.account_name && <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>{o.account_name}</Caption1>}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{fmtEur(o.amount_eur)}</span>
                        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                          {effectiveProbability(o)}%{o.expected_close_date ? ` · ${new Date(o.expected_close_date).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}` : ""}
                        </Caption1>
                      </div>
                      <Select value={o.stage} onChange={(_, d) => move(o, d.value)} style={{ marginTop: 8, width: "100%" }}>
                        {OPP_STAGES.map((s) => <option key={s} value={s}>{OPP_STAGE_LABEL[s]}</option>)}
                      </Select>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
