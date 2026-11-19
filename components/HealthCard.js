"use client";

// Santé de la société (SIRENE + BODACC) + dirigeants légaux.
import { useState } from "react";
import { Card, Body1, Caption1, Badge, Button, Spinner } from "@fluentui/react-components";
import { ShieldCheckmark24Regular, ArrowClockwise24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import { HEALTH_META } from "@/lib/health-meta";

export default function HealthCard({ account, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const d = account.health_detail || {};
  const meta = HEALTH_META[account.health_status];

  async function recheck() {
    setBusy(true); onError?.("");
    const r = await fetchJson(`/api/accounts/${account.id}/health`, { method: "POST" });
    setBusy(false);
    if (!r.ok) { onError?.(r.error); return; }
    onDone?.();
  }

  return (
    <Card style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ShieldCheckmark24Regular />
          <Body1 style={{ fontWeight: 700 }}>Santé de la société</Body1>
          {meta ? <Badge appearance="filled" color={meta.color}>{meta.label}</Badge> : <Badge appearance="outline">Non contrôlée</Badge>}
        </div>
        <Button size="small" appearance="subtle" disabled={busy}
          icon={busy ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} onClick={recheck}>
          {account.health_checked_at ? "Revérifier" : "Vérifier"}
        </Button>
      </div>
      {account.health_label && <Caption1 style={{ display: "block", marginTop: 8 }}>{account.health_label}</Caption1>}
      {d.siren && (
        <Caption1 style={{ display: "block", marginTop: 4, color: "var(--colorNeutralForeground2)" }}>
          {d.sirene_name} · SIREN{" "}
          <a href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${d.siren}`} target="_blank" rel="noreferrer">{d.siren}</a>
          {d.commune ? ` · ${d.commune}` : ""}
          {d.match_confidence === "probable" ? " · rapprochement probable, à confirmer" : ""}
        </Caption1>
      )}
      {d.procedure_nature && (
        <Caption1 style={{ display: "block", marginTop: 4 }}>
          BODACC : {d.procedure_nature}{d.procedure_date ? ` (${d.procedure_date})` : ""}
        </Caption1>
      )}
      {(d.dirigeants || []).length > 0 && (
        <Caption1 style={{ display: "block", marginTop: 4, color: "var(--colorNeutralForeground2)" }}>
          Dirigeants légaux : {d.dirigeants.map((x) => `${x.name}${x.role ? ` (${x.role})` : ""}`).join(", ")}
        </Caption1>
      )}
      {account.health_checked_at && (
        <Caption1 style={{ display: "block", marginTop: 4, color: "var(--colorNeutralForeground3)" }}>
          Contrôlé le {new Date(account.health_checked_at).toLocaleDateString("fr-FR")}
        </Caption1>
      )}
    </Card>
  );
}
