"use client";

// Renseignements publics collectés gratuitement (sans IA) : site, standard,
// emails, réseaux, outils repérés (site + DNS), emails probables des dirigeants,
// marchés publics informatiques. Voir lib/account-intel.js.
import { useState } from "react";
import { Card, Body1, Caption1, Badge, Button, Spinner } from "@fluentui/react-components";
import {
  DatabaseSearch24Regular, ArrowClockwise24Regular, Phone24Regular, Mail24Regular, Globe24Regular, LinkSquare24Regular,
} from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";

const BRAND = "#0F7B6C";
const Row = ({ label, children }) => (
  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "3px 0" }}>
    <Caption1 style={{ minWidth: 128, color: "var(--colorNeutralForeground3)" }}>{label}</Caption1>
    <div style={{ flex: 1, minWidth: 200, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
  </div>
);
const MATCH = { verifie: ["SIREN trouvé sur le site", "success"], probable: ["nom concordant", "warning"] };

export default function IntelCard({ account, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const w = account.web_intel;

  async function run() {
    setBusy(true); onError?.("");
    const r = await fetchJson(`/api/accounts/${account.id}/intel`, { method: "POST" });
    setBusy(false);
    if (!r.ok) { onError?.(r.error); return; }
    onDone?.();
  }

  const tech = w?.tech || [];
  const byCat = tech.reduce((m, t) => ((m[t.cat] = [...(m[t.cat] || []), t.label]), m), {});

  return (
    <Card style={{ padding: "18px 20px", borderLeft: `3px solid ${BRAND}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DatabaseSearch24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Renseignements publics</Body1>
          <Badge appearance="tint" color="success">gratuit · sans IA</Badge>
        </div>
        <Button size="small" appearance={w ? "subtle" : "primary"} disabled={busy}
          icon={busy ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} onClick={run}>
          {busy ? "Collecte… (≈ 15 s)" : w ? "Actualiser" : "Collecter"}
        </Button>
      </div>

      {!w && !busy && (
        <Caption1 style={{ display: "block", marginTop: 10, color: "var(--colorNeutralForeground2)", lineHeight: 1.6 }}>
          Cherche le site officiel (vérifié par le SIREN), le standard, les emails et la page LinkedIn de la société,
          les outils repérés (Microsoft 365, VMware, Veeam…), les emails probables des dirigeants et, pour un acheteur
          public, ses marchés informatiques.
        </Caption1>
      )}

      {w?.error && <Caption1 style={{ display: "block", marginTop: 8, color: "#C50F1F" }}>Dernière collecte en échec : {w.error}</Caption1>}

      {w && !w.error && (
        <div style={{ marginTop: 12 }}>
          <Row label="Site officiel">
            {w.site ? (
              <>
                <Button as="a" href={w.site.url} target="_blank" rel="noreferrer" size="small" icon={<Globe24Regular />}>
                  {w.site.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                </Button>
                {MATCH[w.site.match] && <Badge appearance="tint" color={MATCH[w.site.match][1]}>{MATCH[w.site.match][0]}</Badge>}
                <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>via {w.site.origin}{w.site.hoster ? ` · hébergé chez ${w.site.hoster}` : ""}</Caption1>
              </>
            ) : <Caption1>Non trouvé{w.tried?.length ? ` (essayé : ${w.tried.slice(0, 4).join(", ")})` : ""}</Caption1>}
          </Row>

          <Row label="Téléphones">
            {w.phones?.length ? w.phones.map((p) => (
              <Button key={p.number} as="a" href={`tel:${p.number.replace(/\s/g, "")}`} size="small" icon={<Phone24Regular />}>
                {p.number}{p.kind === "mobile" ? " (mobile)" : ""}
              </Button>
            )) : <Caption1>—</Caption1>}
          </Row>

          <Row label="Emails">
            {[...(w.emails?.named || []), ...(w.emails?.generic || [])].length
              ? [...(w.emails?.named || []), ...(w.emails?.generic || [])].map((e) => (
                <Button key={e} as="a" href={`mailto:${e}`} size="small" icon={<Mail24Regular />}>{e}</Button>
              )) : <Caption1>—</Caption1>}
          </Row>

          {w.leaders_emails?.length > 0 && (
            <Row label="Dirigeants (email)">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {w.leaders_emails.map((l) => (
                  <Caption1 key={l.email}>
                    {l.name}{l.role ? ` (${l.role})` : ""} — <a href={`mailto:${l.email}`}>{l.email}</a>{" "}
                    <span style={{ color: "var(--colorNeutralForeground3)" }}>· {l.confidence}</span>
                  </Caption1>
                ))}
              </div>
            </Row>
          )}

          <Row label="Réseaux">
            {Object.keys(w.socials || {}).length ? Object.entries(w.socials).map(([k, u]) => (
              <Button key={k} as="a" href={u} target="_blank" rel="noreferrer" size="small" icon={<LinkSquare24Regular />}>
                {k === "linkedin" ? "LinkedIn société" : k}
              </Button>
            )) : <Caption1>—</Caption1>}
            {w.site?.careers_url && (
              <Button as="a" href={w.site.careers_url} target="_blank" rel="noreferrer" size="small" appearance="subtle">Page recrutement</Button>
            )}
          </Row>

          <Row label="Messagerie">
            <Caption1>
              {w.dns?.mail_provider || "—"}
              {w.dns?.mail_gateway ? ` · passerelle ${w.dns.mail_gateway}` : ""}
              {w.dns?.dmarc ? ` · DMARC ${w.dns.dmarc}` : w.dns ? " · pas de DMARC" : ""}
            </Caption1>
          </Row>

          <Row label="Outils repérés">
            {tech.length ? Object.entries(byCat).map(([cat, labels]) => (
              <Badge key={cat} appearance="outline" title={cat}>{cat} : {labels.join(", ")}</Badge>
            )) : <Caption1>—</Caption1>}
          </Row>

          {w.public_contracts && (
            <Row label="Marchés publics IT">
              {w.public_contracts.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {w.public_contracts.map((n) => (
                    <Caption1 key={n.id || n.objet}>
                      {n.ouvert && <Badge appearance="filled" color="danger" size="small" style={{ marginRight: 6 }}>Ouvert jusqu'au {n.limite}</Badge>}
                      {n.date} · {n.nature ? `${n.nature} · ` : ""}
                      {n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.objet || "Avis"}</a> : n.objet}
                      {n.titulaire ? ` — titulaire : ${n.titulaire}` : ""}
                    </Caption1>
                  ))}
                </div>
              ) : <Caption1>Aucun avis informatique récent au BOAMP.</Caption1>}
            </Row>
          )}

          <Caption1 style={{ display: "block", marginTop: 8, color: "var(--colorNeutralForeground3)" }}>
            Collecté le {new Date(w.collected_at).toLocaleDateString("fr-FR")} · sources publiques (site, DNS, Wikidata, BOAMP)
          </Caption1>
        </div>
      )}
    </Card>
  );
}
