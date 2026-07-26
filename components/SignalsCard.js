"use client";

import { Card, Body1, Caption1 } from "@fluentui/react-components";
import { Pulse24Regular } from "@fluentui/react-icons";
import { provenance, NIVEAU_COULEUR, LIGNES, TYPES_SIGNAL, dateCourte, estNonJuge } from "@/lib/veille";

const BRAND = "#5B53E6";

/**
 * Pastille de provenance — l'élément central de cette carte.
 *
 * Le commercial doit pouvoir décider en un coup d'œil s'il peut citer ce signal
 * devant un client. Un rattachement « salle de presse » est certain ; un
 * rattachement « mention presse » repose sur la reconnaissance d'un nom dans un
 * article et s'est déjà trompé. Les afficher de la même façon transformerait
 * une incertitude connue en fausse assurance.
 */
function Provenance({ methode, confiance }) {
  const p = provenance(methode);
  const couleur = NIVEAU_COULEUR[p.niveau];
  const pct = typeof confiance === "number" ? Math.round(confiance * 100) : null;
  return (
    <span
      title={`${p.aide}${pct !== null ? ` (confiance ${pct} %)` : ""}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 11, fontWeight: 600, color: couleur, whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: couleur, flexShrink: 0 }} />
      {p.label}
      {p.niveau === "a_verifier" && pct !== null && ` · ${pct} %`}
    </span>
  );
}

function LigneChip({ ligne }) {
  const l = LIGNES[ligne];
  if (!l || ligne === "none") return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: l.couleur, whiteSpace: "nowrap",
      background: `color-mix(in srgb, ${l.couleur} 12%, transparent)`,
      borderRadius: 6, padding: "2px 8px",
    }}>
      {l.label}
    </span>
  );
}

function SignalRow({ s }) {
  let domaine = "";
  try { domaine = s.source_url ? new URL(s.source_url).hostname.replace(/^www\./, "") : ""; } catch { domaine = ""; }

  return (
    <div style={{
      display: "flex", gap: 12, padding: "12px 0",
      borderBottom: "1px solid var(--colorNeutralStroke2)",
    }}>
      <div style={{ flexShrink: 0, paddingTop: 2, minWidth: 108 }}>
        <LigneChip ligne={s.product_line} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Body1 style={{ fontWeight: 600, display: "block" }}>{s.title || s.detail}</Body1>
        {/* Le résumé du modèle passe DEVANT le texte de la source : c'est la
            phrase française d'un avis allemand, et elle dit pourquoi appeler
            maintenant. Le texte d'origine reste dessous, vérifiable. */}
        {s.summary && (
          <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 3 }}>
            {s.summary}
          </Caption1>
        )}
        {s.title && s.detail && !s.summary && (
          <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 2 }}>
            {s.detail}
          </Caption1>
        )}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 5,
        }}>
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
            {TYPES_SIGNAL[s.type] || s.type}
            {s.observed_at && ` · ${dateCourte(s.observed_at)}`}
          </Caption1>
          <Provenance methode={s.match_method} confiance={s.match_confidence} />
          {estNonJuge(s) && (
            <Caption1
              title="Retenu par correspondance de mots-clés. Aucun modèle ne l'a encore relu : vérifiez qu'il s'agit bien d'un signal d'achat avant de le citer."
              style={{ color: "var(--colorNeutralForeground3)", fontStyle: "italic" }}
            >
              mot-clé seul
            </Caption1>
          )}
          {domaine && (
            <Caption1>
              <a href={s.source_url} target="_blank" rel="noreferrer"
                 style={{ color: BRAND, textDecoration: "none" }}>
                {domaine} ↗
              </a>
            </Caption1>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Signaux de veille d'un compte.
 *
 * Distincte de la carte « Actualités », qui vient de l'analyse LLM du compte :
 * ici les signaux sont collectés en continu depuis des sources déclarées, avec
 * un lien vérifiable et une méthode de rattachement traçable. Les fusionner
 * ferait perdre cette traçabilité, qui est précisément ce qui les rend citables.
 */
export default function SignalsCard({ signals = [] }) {
  if (!signals.length) return null;

  const aVerifier = signals.filter(
    (s) => provenance(s.match_method).niveau === "a_verifier"
  ).length;

  return (
    <Card style={{ padding: "20px 20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <Pulse24Regular style={{ color: BRAND }} />
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Signaux de veille</Body1>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          {signals.length} {signals.length > 1 ? "signaux collectés" : "signal collecté"}
          {aVerifier > 0 && ` · ${aVerifier} à vérifier avant citation`}
        </Caption1>
      </div>
      <div style={{ marginTop: 4 }}>
        {signals.map((s) => <SignalRow key={s.id} s={s} />)}
      </div>
    </Card>
  );
}
