"use client";

// Suivi des emails envoyés : coller la liste des envois (agent Sales Chat de
// suivi, ou Outlook), puis voir les erreurs repérées (doublons, STOP, lead clos…).
import { useState } from "react";
import Link from "next/link";
import { Button, Caption1, Textarea, Badge } from "@fluentui/react-components";
import { fetchJson } from "@/lib/fetch-json";
import { ISSUE_LABELS, ISSUE_ORDER } from "@/lib/sent-emails";

const ISSUE_COLOR = { stop: "danger", doublon: "danger", clos: "warning", traite: "warning", adresse: "warning",
  non_remis: "danger", stop_recu: "danger", reponse: "success", date: "subtle" };

export default function SentEmailsPanel({ onUpdated }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [instr, setInstr] = useState("");
  const [copied, setCopied] = useState(false);

  async function save() {
    setBusy(true); setRes(null);
    const r = await fetchJson("/api/leads/sent-emails", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, source: /date d.envoi;email/i.test(text) ? "agent Sales Chat" : "Outlook" }),
    });
    setBusy(false);
    setRes(r.ok ? r.data : { error: r.error, colonnes: r.data?.colonnes });
    if (r.ok) { setText(""); onUpdated?.(); }
  }
  async function copyInstructions() {
    let t = instr;
    if (!t) {
      const r = await fetchJson("/api/leads/agent-instructions?type=suivi");
      if (!r.ok) return;
      t = r.data.instructions;
      setInstr(t);
    }
    try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignoré */ }
  }

  const groups = {};
  for (const i of res?.erreurs || []) (groups[i.kind] ||= []).push(i);

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      <Caption1>
        Colle la liste de tes emails envoyés. Deux façons de l&apos;obtenir :
        <br />• <strong>Agent Sales Chat de suivi</strong> : crée un agent avec ces instructions, demande-lui « suivi des
        envois de la semaine », puis colle son tableau ici.
        <br />• <strong>Outlook</strong> : Éléments envoyés → tout sélectionner (Ctrl+A) → copier (Ctrl+C) → coller ici.
        Un export CSV d&apos;Outlook marche aussi (colle son contenu).
        <br />Chaque envoi n&apos;est compté qu&apos;une fois. Un lead écrit il y a moins de 25 jours ne repart pas dans le
        fichier de la semaine, et ceux qui ont répondu restent pour toi. Les adresses Dell et les envois hors liste
        ne sont pas enregistrés.
      </Caption1>
      <div>
        <Button size="small" appearance="subtle" onClick={copyInstructions}>
          {copied ? "Instructions copiées" : "Copier les instructions de l'agent de suivi"}
        </Button>
      </div>
      <Textarea value={text} onChange={(_, d) => setText(d.value)} resize="vertical" style={{ minHeight: 140, fontSize: 12.5 }}
        placeholder={"Date d'envoi;Email;Nom;Objet;Statut\n2026-11-24 10:05;contact@exemple.fr;Jean Martin;DELL : Données et Sauvegardes;envoyé"} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="small" appearance="primary" disabled={busy || !text.trim()} onClick={save}>
          {busy ? "Contrôle…" : "Importer et contrôler"}
        </Button>
        {res?.error && (
          <Caption1 style={{ color: "#C50F1F" }}>
            {res.error}{res.colonnes?.length ? ` Colonnes lues : ${res.colonnes.join(" · ")}` : ""}
          </Caption1>
        )}
      </div>
      {res && !res.error && (
        <div style={{ display: "grid", gap: 6 }}>
          <Caption1>
            {res.lus} envoi{res.lus > 1 ? "s" : ""} lu{res.lus > 1 ? "s" : ""} · {res.nouveaux} nouveau{res.nouveaux > 1 ? "x" : ""}
            {res.deja_connus > 0 && ` · ${res.deja_connus} déjà connu${res.deja_connus > 1 ? "s" : ""}`}
            {res.hors_liste > 0 && ` · ${res.hors_liste} hors liste (non enregistrés${res.hors_liste_exemples?.length ? ` : ${res.hors_liste_exemples.join(", ")}` : ""})`}
            {res.internes_ignores > 0 && ` · ${res.internes_ignores} interne${res.internes_ignores > 1 ? "s" : ""} Dell ignoré${res.internes_ignores > 1 ? "s" : ""}`}
          </Caption1>
          {!res.erreurs?.length && <Caption1 style={{ color: "#107C10" }}>Aucune erreur : pas de doublon, de STOP ni de lead clos.</Caption1>}
          {ISSUE_ORDER.filter((k) => groups[k]).map((k) => (
            <div key={k} style={{ display: "grid", gap: 2 }}>
              <div><Badge appearance="tint" color={ISSUE_COLOR[k]}>{ISSUE_LABELS[k]} : {groups[k].length}</Badge></div>
              {groups[k].slice(0, 12).map((i, n) => (
                <Caption1 key={n} style={{ paddingLeft: 8 }}>
                  {i.lead_id ? <Link href={`/accounts/${i.lead_id}`}>{i.lead}</Link> : i.lead} — {i.email} : {i.detail}
                </Caption1>
              ))}
              {groups[k].length > 12 && <Caption1 style={{ paddingLeft: 8 }}>… et {groups[k].length - 12} autres</Caption1>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
