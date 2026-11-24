"use client";

// Brief d'appel : verdict, anomalies à corriger, actualité, question
// d'ouverture et note Salesforce à copier ; plus le collage de la fiche
// Salesforce, analysée dans le navigateur (seules les données société et les
// codes d'anomalie partent au serveur).
import { useState } from "react";
import { Card, Body1, Caption1, Badge, Button, Textarea, Spinner } from "@fluentui/react-components";
import { ClipboardTextLtr24Regular, Copy24Regular, Checkmark24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import { parseSalesforcePaste } from "@/lib/sf-paste";

export default function BriefCard({ account, brief, onDone, onError }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  if (!brief) return null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(brief.sfNote); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const analyse = () => setPreview(parseSalesforcePaste(text, { siegeCp: account.health_detail?.siege_cp || "" }));
  const send = async () => {
    const p = preview || parseSalesforcePaste(text, { siegeCp: account.health_detail?.siege_cp || "" });
    setBusy(true);
    const r = await fetchJson(`/api/accounts/${account.id}/sf-paste`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code_postal: p.code_postal, commune: p.commune, rue: p.rue, generic_emails: p.generic_emails, domains: p.domains, flags: p.flags }),
    });
    setBusy(false);
    if (!r.ok) { onError(r.error); return; }
    setText(""); setPreview(null); setOpen(false); onDone();
  };
  const forget = async () => {
    const r = await fetchJson(`/api/accounts/${account.id}/sf-paste`, { method: "DELETE" });
    if (!r.ok) { onError(r.error); return; }
    onDone();
  };

  return (
    <Card style={{ padding: "16px 20px", borderLeft: "3px solid #5B53E6" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Brief</Body1>
        <Badge appearance="filled" color={brief.verdict_color}>{brief.verdict_label}</Badge>
        <Body1 style={{ flex: 1, minWidth: 220 }}>{brief.reason}</Body1>
        <Button size="small" icon={copied ? <Checkmark24Regular /> : <Copy24Regular />} onClick={copy}>
          {copied ? "Copiée" : "Copier la note Salesforce"}
        </Button>
      </div>

      {brief.anomalies.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
          {brief.anomalies.map((a) => (
            <Caption1 key={a.code} style={{ display: "block", color: a.sf ? "var(--colorPaletteDarkOrangeForeground1)" : "var(--colorNeutralForeground2)" }}>
              {a.sf ? "⚠ " : "• "}<strong>{a.label}</strong>{a.detail ? ` — ${a.detail}` : ""}{a.sf ? " · à corriger dans Salesforce" : ""}
            </Caption1>
          ))}
        </div>
      )}

      <Caption1 style={{ display: "block", marginTop: 10 }}>
        <strong>Question d'ouverture :</strong> « {brief.openingQuestion} »
      </Caption1>

      {brief.news.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 2 }}>
          {brief.news.map((n, i) => (
            <Caption1 key={i} style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>
              {n.date ? `${new Date(n.date).toLocaleDateString("fr-FR")} · ` : ""}{n.text} <span style={{ color: "var(--colorNeutralForeground3)" }}>({n.source})</span>
            </Caption1>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Button size="small" appearance="subtle" icon={<ClipboardTextLtr24Regular />} onClick={() => setOpen((v) => !v)}>
          {account.sf_paste_flags ? "Recoller la fiche Salesforce" : "Coller la fiche Salesforce"}
        </Button>
        {account.sf_paste_flags && (
          <>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Fiche contrôlée le {new Date(account.sf_paste_flags.at).toLocaleDateString("fr-FR")}
              {account.sf_paste_flags.code_postal ? ` (${account.sf_paste_flags.code_postal} ${account.sf_paste_flags.commune || ""})` : ""}
            </Caption1>
            <Button size="small" appearance="subtle" onClick={forget}>Oublier</Button>
          </>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <Caption1>
            Copie toute la fiche du lead dans Salesforce et colle-la ici. Elle est analysée sur ton appareil : seuls
            l'adresse de la société, ses emails génériques, les domaines d'email et les anomalies trouvées sont
            enregistrés. Aucun nom, email ou téléphone nominatif n'est gardé.
          </Caption1>
          <Textarea value={text} onChange={(_, d) => { setText(d.value); setPreview(null); }} resize="vertical" style={{ minHeight: 140, fontSize: 12.5 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Button size="small" disabled={!text.trim()} onClick={analyse}>Analyser</Button>
            <Button size="small" appearance="primary" disabled={!text.trim() || busy} onClick={send}>
              {busy ? <Spinner size="tiny" /> : "Contrôler et enregistrer"}
            </Button>
          </div>
          {preview && (
            <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>
              Lu : {preview.code_postal || "pas de code postal"} {preview.commune} {preview.rue ? `· ${preview.rue}` : ""}
              {" · "}{preview.counts.emails} email(s), dont {preview.generic_emails.length} générique(s) · {preview.counts.phones} téléphone(s)
              {preview.flags.length ? ` · déjà repéré : ${preview.flags.map((f) => f.code).join(", ")}` : ""}
              {" · "}envoyé au serveur : adresse, {preview.generic_emails.length} email(s) générique(s), {preview.domains.length} domaine(s)
            </Caption1>
          )}
        </div>
      )}
    </Card>
  );
}
