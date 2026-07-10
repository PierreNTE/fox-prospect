"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Title2, Body1, Caption1 } from "@fluentui/react-components";
import { STATUS_ORDER, STATUS_LABELS } from "@/lib/constants";
import { COLORS, STAGE_COLORS, scoreColor } from "@/lib/design-tokens";

// Kanban du funnel (Sprint 3) — drag & drop natif HTML5, sans dépendance.
// Déposer une carte dans une colonne = changement de statut (optimiste,
// rollback si l'API échoue).

function ProspectCard({ p, onOpen, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, p.id)}
      onClick={() => onOpen(p.id)}
      style={{
        padding: "10px 12px", borderRadius: 8, cursor: "grab",
        background: "var(--colorNeutralBackground1)",
        border: "1px solid var(--colorNeutralStroke2)",
        boxShadow: "var(--shadow2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <Body1 style={{ fontWeight: 600, fontSize: 13 }}>{p.first_name} {p.last_name}</Body1>
        {p.fit_score != null && (
          <span style={{ fontWeight: 700, fontSize: 12, color: scoreColor(p.fit_score), flexShrink: 0 }}>
            {p.fit_score}
          </span>
        )}
      </div>
      <Caption1 style={{ color: COLORS.neutral, display: "block", marginTop: 1 }}>
        {p.company}
      </Caption1>
      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
        {p.follow_up_at && (
          <span style={{
            fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "0 4px",
            color: p.follow_up_at < new Date().toISOString().slice(0, 10) ? COLORS.danger : COLORS.neutral,
            border: `1px solid currentColor`,
          }}>
            ⏰ {new Date(p.follow_up_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
          </span>
        )}
        {(p.tags || []).slice(0, 3).map((t) => (
          <span key={t} style={{ fontSize: 10, fontWeight: 600, color: COLORS.brand, border: `1px solid ${COLORS.brand}`, borderRadius: 6, padding: "0 5px" }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PipelineClient({ initialProspects = null }) {
  const router = useRouter();
  const [prospects, setProspects] = useState(initialProspects || []);
  const [dragOver, setDragOver] = useState(null);
  const [error, setError] = useState("");

  const columns = useMemo(() => {
    const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]));
    for (const p of prospects) (byStatus[p.status] || byStatus.non_contacte).push(p);
    // Dans chaque colonne : meilleurs scores en tête.
    for (const s of STATUS_ORDER) byStatus[s].sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
    return byStatus;
  }, [prospects]);

  const onDragStart = (e, id) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = async (e, status) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const prospect = prospects.find((p) => p.id === id);
    if (!prospect || prospect.status === status) return;

    const previous = prospect.status;
    // Optimiste : la carte change de colonne immédiatement.
    setProspects((list) => list.map((p) => (p.id === id ? { ...p, status } : p)));

    const res = await fetch(`/api/prospects/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (!res?.ok) {
      setProspects((list) => list.map((p) => (p.id === id ? { ...p, status: previous } : p)));
      setError("Le changement de statut a échoué — carte remise en place.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div>
        <Title2>Pipeline</Title2>
        <Body1 style={{ color: COLORS.neutral, display: "block", marginTop: 2 }}>
          Glisse une carte pour changer son statut.
        </Body1>
      </div>

      {error && (
        <Card style={{ borderLeft: `3px solid ${COLORS.danger}`, padding: "10px 14px" }}>
          <Body1 style={{ color: COLORS.danger }}>{error}</Body1>
        </Card>
      )}

      <div style={{ display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 8, flex: 1 }}>
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            onDragOver={(e) => { e.preventDefault(); setDragOver(status); }}
            onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
            onDrop={(e) => onDrop(e, status)}
            style={{
              flex: "0 0 240px", minWidth: 240, borderRadius: 10,
              background: dragOver === status
                ? `color-mix(in srgb, ${STAGE_COLORS[status]} 8%, var(--colorNeutralBackground2))`
                : "var(--colorNeutralBackground2)",
              border: `1px solid ${dragOver === status ? STAGE_COLORS[status] : "var(--colorNeutralStroke2)"}`,
              transition: "background .12s, border-color .12s",
            }}
          >
            <div style={{
              padding: "10px 12px", display: "flex", alignItems: "center", gap: 8,
              borderBottom: "1px solid var(--colorNeutralStroke2)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STAGE_COLORS[status] }} />
              <Body1 style={{ fontWeight: 700, fontSize: 13 }}>{STATUS_LABELS[status]}</Body1>
              <Caption1 style={{ color: COLORS.neutral, marginLeft: "auto" }}>
                {columns[status].length}
              </Caption1>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80, maxHeight: "70vh", overflowY: "auto" }}>
              {columns[status].slice(0, 100).map((p) => (
                <ProspectCard key={p.id} p={p} onDragStart={onDragStart}
                  onOpen={(id) => router.push(`/prospects/${id}`)} />
              ))}
              {columns[status].length > 100 && (
                <Caption1 style={{ color: COLORS.neutral, textAlign: "center" }}>
                  +{columns[status].length - 100} autres — affine avec la liste
                </Caption1>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
