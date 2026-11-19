"use client";

// Préparation d'un appel à froid : actu, qui chercher dans ZoomInfo,
// comment passer le standard, ouverture, questions de qualification.
import { useState } from "react";
import { Card, Body1, Caption1, Button, Spinner } from "@fluentui/react-components";
import { Call24Regular, Sparkle24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";

const BRAND = "#5B53E6";

function Section({ title, children, color }) {
  return (
    <div>
      <Body1 style={{ fontWeight: 700, fontSize: 14, display: "block", marginBottom: 6, color }}>{title}</Body1>
      {children}
    </div>
  );
}

const Item = ({ children }) => (
  <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)", padding: "3px 0", lineHeight: 1.55 }}>
    {children}
  </Caption1>
);

export default function CallPrepCard({ accountId, prep, generatedAt, onDone, onError }) {
  const [busy, setBusy] = useState(false);

  async function run(force) {
    setBusy(true); onError?.("");
    const r = await fetchJson("/api/call-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, force: !!force }),
    });
    setBusy(false);
    if (!r.ok) { onError?.(r.error); return; }
    onDone?.();
  }

  return (
    <Card style={{ padding: "20px 20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Call24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Préparer l'appel</Body1>
        </div>
        <Button appearance={prep ? "outline" : "primary"} size="small" disabled={busy}
          icon={busy ? <Spinner size="tiny" /> : <Sparkle24Regular />} onClick={() => run(!!prep)}>
          {busy ? "Recherche…" : prep ? "Régénérer" : "Préparer (IA + web)"}
        </Button>
      </div>

      {!prep && !busy && (
        <Caption1 style={{ display: "block", marginTop: 10, color: "var(--colorNeutralForeground2)", lineHeight: 1.6 }}>
          Actu de la société, intitulés à chercher dans ZoomInfo, phrases pour passer le standard, accroche
          d'ouverture et questions pour remplir la fiche de qualif. Une recherche web, sous ton plafond budgétaire.
        </Caption1>
      )}

      {prep && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          {prep.identite && <Body1 style={{ lineHeight: 1.6, color: "var(--colorNeutralForeground2)" }}>{prep.identite}</Body1>}

          {prep.actus?.length > 0 && (
            <Section title="Actu exploitable">
              {prep.actus.map((a, i) => (
                <Item key={i}>
                  <strong>{a.titre}</strong>{a.date ? ` · ${a.date}` : ""}
                  {a.accroche ? <><br />→ « {a.accroche} »</> : null}
                  {a.source && /^https?:/.test(a.source) ? <> · <a href={a.source} target="_blank" rel="noreferrer">source</a></> : null}
                </Item>
              ))}
            </Section>
          )}

          {prep.interlocuteurs?.length > 0 && (
            <Section title="Qui chercher dans ZoomInfo">
              {prep.interlocuteurs.map((p, i) => (
                <Item key={i}>
                  <strong>{p.poste}</strong>{p.nom ? ` — ${p.nom}` : ""} : {p.pourquoi}
                </Item>
              ))}
            </Section>
          )}

          {(prep.standard?.phrases?.length > 0) && (
            <Section title="Passer le standard">
              {prep.standard.phrases.map((p, i) => <Item key={i}>« {p} »</Item>)}
              {prep.standard.si_mail && <Item><strong>« Envoyez un mail »</strong> → {prep.standard.si_mail}</Item>}
              {prep.standard.si_absent && <Item><strong>« Il n'est pas là »</strong> → {prep.standard.si_absent}</Item>}
              {prep.standard.conseils?.map((c, i) => <Item key={`c${i}`}>💡 {c}</Item>)}
            </Section>
          )}

          {prep.ouverture && (
            <div style={{ padding: "12px 14px", borderRadius: 8, borderLeft: `3px solid ${BRAND}`,
              background: `color-mix(in srgb, ${BRAND} 6%, var(--colorNeutralBackground1))` }}>
              <Caption1 style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--colorNeutralForeground3)" }}>
                Ouverture
              </Caption1>
              <Body1 style={{ display: "block", marginTop: 4 }}>{prep.ouverture}</Body1>
            </div>
          )}

          {prep.questions?.length > 0 && (
            <Section title="Questions de découverte">
              {prep.questions.map((q, i) => <Item key={i}>{i + 1}. {q}</Item>)}
            </Section>
          )}

          {prep.hypotheses?.length > 0 && (
            <Section title="Hypothèses à vérifier">
              {prep.hypotheses.map((h, i) => <Item key={i}>· {h}</Item>)}
            </Section>
          )}

          {prep.objections?.length > 0 && (
            <Section title="Objections probables">
              {prep.objections.map((o, i) => <Item key={i}><strong>{o.objection}</strong> → {o.reponse}</Item>)}
            </Section>
          )}

          {generatedAt && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Préparé le {new Date(generatedAt).toLocaleString("fr-FR")}
            </Caption1>
          )}
        </div>
      )}
    </Card>
  );
}
