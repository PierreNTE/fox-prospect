"use client";

// Fiche de qualification Dell, à remplir PENDANT l'appel.
// Sauvegarde automatique (anti-rebond) + résumé prêt à coller dans Salesforce.

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Body1, Caption1, Input, Textarea, Button, Badge, ProgressBar, Field } from "@fluentui/react-components";
import { Copy24Regular, Checkmark24Regular, Server24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import { QUALIF_SECTIONS, qualifProgress, salesforceSummary, fmtMonth } from "@/lib/dell-qualif";

const BRAND = "#5B53E6";

export default function DellQualifCard({ accountId, accountName, initial = {}, savedAt = null }) {
  const [q, setQ] = useState(initial || {});
  const [state, setState] = useState(savedAt ? "saved" : "idle"); // idle | dirty | saving | saved | error
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const lastSaved = useRef(JSON.stringify(initial || {}));

  useEffect(() => {
    const snapshot = JSON.stringify(q);
    if (snapshot === lastSaved.current) return;
    setState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState("saving");
      const r = await fetchJson(`/api/accounts/${accountId}/qualif`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualif: q }),
      });
      if (r.ok) lastSaved.current = snapshot;
      setState(r.ok ? "saved" : "error");
    }, 900);
    return () => clearTimeout(timer.current);
  }, [q, accountId]);

  const set = (section, key, value) =>
    setQ((prev) => ({ ...prev, [section]: { ...(prev[section] || {}), [key]: value } }));

  const progress = useMemo(() => qualifProgress(q), [q]);
  const summary = useMemo(() => salesforceSummary(q, { accountName }), [q, accountName]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card style={{ padding: "20px 20px 22px", borderLeft: `3px solid ${BRAND}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Server24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Qualification Dell</Body1>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Badge appearance={progress.opportunity ? "filled" : "outline"} color={progress.opportunity ? "success" : "informative"}>
            {progress.opportunity ? "Opportunité qualifiée" : "Opportunité : à qualifier"}
          </Badge>
          <Badge appearance={progress.nextStep ? "filled" : "outline"} color={progress.nextStep ? "success" : "informative"}>
            {progress.nextStep ? "Next step : BANT complet" : `BANT ${progress.sections.bant.done}/${progress.sections.bant.total}`}
          </Badge>
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
            {state === "saving" ? "Enregistrement…" : state === "saved" ? "Enregistré" : state === "error" ? "Échec de l'enregistrement" : state === "dirty" ? "…" : ""}
          </Caption1>
        </div>
      </div>

      {progress.renewalSoon.length > 0 && (
        <Caption1 style={{ display: "block", marginTop: 10, color: "#C25E00", fontWeight: 600 }}>
          Fenêtre de renouvellement :{" "}
          {progress.renewalSoon
            .map((e) => `${QUALIF_SECTIONS.find((s) => s.key === e.block).title.toLowerCase()} ${fmtMonth(e.eos)}${e.months < 0 ? " (déjà échue)" : ` (dans ${e.months} mois)`}`)
            .join(" · ")}
        </Caption1>
      )}

      <div style={{ marginTop: 12 }}>
        <Caption1>Qualif infra {progress.infra.done}/{progress.infra.total}</Caption1>
        <ProgressBar value={progress.infra.ratio} thickness="large" />
      </div>

      <div style={{ display: "grid", gap: 18, marginTop: 16 }}>
        {QUALIF_SECTIONS.map((s) => (
          <div key={s.key}>
            <Body1 style={{ fontWeight: 700, display: "block", marginBottom: 8 }}>
              {s.title}
              {progress.sections[s.key].total > 0 && (
                <Caption1 style={{ marginLeft: 8, color: "var(--colorNeutralForeground3)" }}>
                  {progress.sections[s.key].done}/{progress.sections[s.key].total}
                </Caption1>
              )}
            </Body1>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
              {s.fields.map((f) => {
                const value = q?.[s.key]?.[f.key] || "";
                const label = `${f.label}${f.key_info ? " ★" : ""}`;
                return (
                  <Field key={f.key} label={label} style={f.multiline ? { gridColumn: "1 / -1" } : undefined}>
                    {f.multiline ? (
                      <Textarea value={value} placeholder={f.placeholder} resize="vertical"
                        onChange={(_, d) => set(s.key, f.key, d.value)} />
                    ) : (
                      <Input value={value} type={f.type || "text"} placeholder={f.placeholder}
                        onChange={(_, d) => set(s.key, f.key, d.value)} />
                    )}
                  </Field>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <Body1 style={{ fontWeight: 700 }}>Résumé pour Salesforce</Body1>
          <Button appearance="primary" icon={copied ? <Checkmark24Regular /> : <Copy24Regular />} onClick={copy}>
            {copied ? "Copié" : "Copier"}
          </Button>
        </div>
        <pre style={{
          marginTop: 8, padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.5,
          background: "var(--colorNeutralBackground3)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}>{summary}</pre>
      </div>
    </Card>
  );
}
