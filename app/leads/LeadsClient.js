"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Card,
  Button,
  Title2,
  Title3,
  Body1,
  Caption1,
  Badge,
  Spinner,
  Checkbox,
  Input,
  Textarea,
  ProgressBar,
  Table,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
  TableHeaderCell,
} from "@fluentui/react-components";
import { ArrowUpload24Regular, ArrowDownload24Regular, Delete24Regular, Search24Regular, ArrowClockwise24Regular, Phone24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import CallButton from "@/components/CallButton";
import SentEmailsPanel from "@/components/SentEmailsPanel";
import { buildCallQueue, isLeadOpen } from "@/lib/call-session";
import { weekStats, NO_ANSWER_LIMIT } from "@/lib/call-history";
import { dedupeByCompany, parsePastedCompanies } from "@/lib/salesforce-leads";
import { readLeadsPdf } from "@/lib/salesforce-pdf";
import { readLeadsReport } from "@/lib/salesforce-report";
import { HEALTH_META } from "@/lib/health-meta";
import { CALL_STATUS_META, isFinalStatus, recallDue, sfStatusLabel, sfStatusRank, sortLeadsByStatus } from "@/lib/call-status";

const BRAND = "#5B53E6";

const BATCH = 6;

// Suppression de tous les leads (confirmation explicite : action irréversible).
async function deleteAllLeads(count) {
  if (!confirm(`Supprimer les ${count} leads actuels ?\n\nLeur suivi d'appel, notes, contacts et emails trouvés seront effacés. Les autres comptes ne sont pas touchés.`)) return null;
  return fetchJson("/api/leads", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "SUPPRIMER" }),
  });
}

function ImportCard({ onImported, onDeleted, startOpen = true, existing = 0 }) {
  const [open, setOpen] = useState(startOpen);
  const [mode, setMode] = useState("keep"); // keep : conserver et mettre à jour · replace : supprimer puis importer
  const inputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [ocrStep, setOcrStep] = useState(null); // { page, pages } pendant la lecture OCR
  const [parsed, setParsed] = useState(null); // { companies, total, rows }
  const [statuses, setStatuses] = useState({ New: true, Working: true, "Closed by Sales": false, "Rejected by Sales": false });
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [diag, setDiag] = useState(null);
  const [paste, setPaste] = useState("");
  const stopRef = useRef(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setSummary(null); setDiag(null); setParsing(true); setOcrStep(null);
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
      if (!isPdf) {
        // Report Salesforce exporté (.xls = tableau HTML, ou .csv) : lecture directe, sans OCR.
        const { rows, diagnostic } = await readLeadsReport(file);
        if (!rows.length) {
          setDiag(diagnostic);
          throw new Error("Aucun lead reconnu dans ce fichier : il faut au moins une colonne « Company / Account » (ou Société).");
        }
        setParsed({ rows, total: rows.length, companies: dedupeByCompany(rows), report: true });
        return;
      }
      const { rows, total, diagnostic, ocr } = await readLeadsPdf(file, { onProgress: setOcrStep });
      if (!rows.length) {
        setDiag(diagnostic);
        throw new Error(
          diagnostic?.textItems
            ? "Aucun lead reconnu : je ne trouve pas la ligne d'en-tête (Company / Société, Created Date…). Détail ci-dessous — ou colle la liste des sociétés."
            : "Ce PDF ne contient pas de texte et l'OCR n'a pas retrouvé le tableau. Imprime la vue « Printable View » avec « Enregistrer au format PDF », ou colle la liste des sociétés."
        );
      }
      setParsed({ rows, total, ocr, companies: dedupeByCompany(rows) });
    } catch (err) {
      setError(err.message);
    } finally {
      setParsing(false);
      setOcrStep(null);
      e.target.value = "";
    }
  }

  const counts = useMemo(() => {
    const c = {};
    (parsed?.companies || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [parsed]);

  const selected = (parsed?.companies || []).filter((r) => statuses[r.status] ?? true);

  async function run() {
    if (mode === "replace" && existing > 0) {
      const d = await deleteAllLeads(existing);
      if (!d) return;
      if (!d.ok) { setError(d.error); return; }
      onDeleted?.();
    }
    setRunning(true); setDone(0); setError(null); stopRef.current = false;
    const tally = { active: 0, vigilance: 0, fermee: 0, introuvable: 0, erreurs: 0 };
    for (let i = 0; i < selected.length; i += BATCH) {
      if (stopRef.current) break;
      const leads = selected.slice(i, i + BATCH).map(({ company, status, campaign, sf_lead_id, duns, city, postal }) =>
        ({ company, status, campaign, sf_lead_id, duns, city, postal }));
      const r = await fetchJson("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads }),
      });
      if (!r.ok) { setError(r.error); break; }
      for (const x of r.data.results || []) {
        if (x.error) tally.erreurs++;
        else tally[x.status] = (tally[x.status] || 0) + 1;
      }
      setDone(Math.min(i + BATCH, selected.length));
      setSummary({ ...tally });
    }
    setRunning(false);
    onImported();
  }

  if (!open) {
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button appearance="primary" icon={<ArrowUpload24Regular />} onClick={() => setOpen(true)}>
          Importer la liste de la semaine
        </Button>
        {existing > 0 && (
          <Button appearance="subtle" icon={<Delete24Regular />} style={{ color: "#C50F1F" }} onClick={async () => {
            const d = await deleteAllLeads(existing);
            if (!d) return;
            if (!d.ok) { setError(d.error); return; }
            onDeleted?.();
          }}>
            Supprimer tous les leads
          </Button>
        )}
        {error && <Caption1 style={{ color: "#C50F1F", alignSelf: "center" }}>{error}</Caption1>}
      </div>
    );
  }

  return (
    <Card style={{ padding: "20px 20px 22px", borderLeft: `3px solid ${BRAND}` }}>
      <Body1><strong>Importer un export Salesforce (report Excel ou PDF)</strong></Body1>
      <Caption1 style={{ display: "block", marginTop: 4 }}>
        Le plus fiable : le report exporté en .xls ou .csv (Company / Account, Lead Tracking ID, Lead Status…).
        Sinon, la Printable View imprimée en PDF. Chaque société est contrôlée (active, fermée, reprise sous un
        autre nom), puis la recherche du contact et de l&apos;accroche démarre automatiquement. Seuls la société,
        le statut, la campagne, l&apos;ID du lead et le DUNS sont conservés.
      </Caption1>

      <input ref={inputRef} type="file" accept="application/pdf,.pdf,.xls,.csv,.html,text/csv,application/vnd.ms-excel" hidden onChange={onFile} />
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Button appearance="primary" icon={<ArrowUpload24Regular />} disabled={parsing || running}
          onClick={() => inputRef.current?.click()}>
          {parsing ? "Lecture du fichier…" : "Choisir le fichier (.xls, .csv ou PDF)"}
        </Button>
        {parsing && <Spinner size="tiny" />}
        {parsing && ocrStep && (
          <Caption1>PDF sans texte : lecture par OCR, page {ocrStep.page}/{ocrStep.pages}… (≈ 10 s par page)</Caption1>
        )}
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer" }}><Caption1>Ou coller une liste de sociétés (une par ligne, ou colonnes copiées depuis Salesforce / Excel)</Caption1></summary>
        <Textarea value={paste} onChange={(_, d) => setPaste(d.value)} resize="vertical" rows={6}
          placeholder={"ACME INDUSTRIE\nBETA SANTE (Lyon)\nCommune de Buxy (71)"} style={{ width: "100%", marginTop: 8 }} />
        <Button style={{ marginTop: 8 }} disabled={!paste.trim() || running} onClick={() => {
          const rows = parsePastedCompanies(paste);
          setError(null); setDiag(null); setSummary(null);
          setParsed({ rows, total: null, companies: dedupeByCompany(rows) });
        }}>Utiliser cette liste</Button>
      </details>

      {parsed && (
        <div style={{ marginTop: 16 }}>
          <Caption1>
            {parsed.rows.length} leads lus{parsed.total ? ` sur ${parsed.total} annoncés` : ""} ·{" "}
            {parsed.companies.length} sociétés distinctes
            {parsed.ocr ? " · lu par OCR : vérifie l'orthographe des noms avant d'importer" : ""}
          </Caption1>
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer" }}><Caption1>Voir les sociétés lues</Caption1></summary>
            <Caption1 style={{ display: "block", marginTop: 6, lineHeight: 1.6 }}>
              {parsed.companies.map((c) => `${c.company}${c.status ? ` (${c.status})` : ""}`).join(" · ")}
            </Caption1>
          </details>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
            {Object.entries(counts).map(([st, n]) => (
              <Checkbox key={st} label={`${st} (${n})`} checked={statuses[st] ?? true}
                onChange={(_, d) => setStatuses((s) => ({ ...s, [st]: !!d.checked }))} disabled={running} />
            ))}
          </div>
          {existing > 0 && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
              <Checkbox label={`Conserver les ${existing} leads actuels (mise à jour, suivi d'appel gardé)`} checked={mode === "keep"}
                onChange={() => setMode("keep")} disabled={running} />
              <Checkbox label="Remplacer : supprimer les leads actuels avant l'import" checked={mode === "replace"}
                onChange={() => setMode("replace")} disabled={running} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Button appearance="primary" disabled={running || !selected.length} onClick={run}>
              Contrôler et importer {selected.length} sociétés
            </Button>
            {running && <Button onClick={() => { stopRef.current = true; }}>Arrêter</Button>}
            <Caption1>≈ {Math.ceil(selected.length * 1.2 / 60)} min, puis la recherche démarre toute seule</Caption1>
          </div>
          {(running || done > 0) && (
            <div style={{ marginTop: 12 }}>
              <ProgressBar value={selected.length ? done / selected.length : 0} />
              <Caption1>{done} / {selected.length}</Caption1>
            </div>
          )}
          {summary && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {Object.entries(HEALTH_META).map(([k, m]) => (
                <Badge key={k} appearance="tint" color={m.color}>{m.label} : {summary[k] || 0}</Badge>
              ))}
              {summary.erreurs > 0 && <Badge appearance="tint" color="danger">Erreurs : {summary.erreurs}</Badge>}
            </div>
          )}
        </div>
      )}
      {error && <Caption1 style={{ color: "#C50F1F", display: "block", marginTop: 10 }}>{error}</Caption1>}
      {diag && (
        <pre style={{ marginTop: 8, padding: 10, borderRadius: 8, fontSize: 11.5, whiteSpace: "pre-wrap",
          background: "var(--colorNeutralBackground3)" }}>
          {diag.headers
            ? `Colonnes du fichier : ${diag.headers.join(" · ") || "aucune"}`
            : `Pages : ${diag.pages} · fragments de texte : ${diag.textItems} · en-tête trouvé : ${diag.headerFound ? "oui" : "non"}`}
          {diag.columns?.length ? `\nColonnes : ${diag.columns.join(", ")}` : ""}
          {diag.sample?.length ? `\nDébut du texte lu :\n- ${diag.sample.join("\n- ")}` : ""}
        </pre>
      )}
    </Card>
  );
}

const TIER_COLOR = { A: "success", B: "warning", C: "informative", X: "subtle" };

// Priorité d'appel déterministe (lib/lead-priority.js) ; le détail des points au survol.
function PriorityBadge({ p }) {
  if (!p) return <Caption1>—</Caption1>;
  const title = [...(p.reasons || []), ...(p.flags || []).map((f) => `⚠ ${f}`)].join("\n");
  return (
    <Badge appearance="tint" color={TIER_COLOR[p.tier] || "subtle"} title={title}>
      {p.tier === "X" ? "—" : p.tier}
    </Badge>
  );
}

// Avancement de la recherche automatique (après import, puis toutes les 15 min).
// Un seul bouton : tout mettre à jour maintenant (collecte + repreneurs + recherches).
function ProgressCard({ progress, running, log, onRun, briefs }) {
  const p = progress || {};
  const queue = (p.sites_pending || 0) + (p.people_pending || 0) + (p.phones_pending || 0);
  const busy = running || queue > 0 || (p.active && p.collected < p.active);
  const pct = p.active ? Math.round((100 * (p.fiches || 0)) / p.active) : 0;
  return (
    <Card style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Body1 style={{ flex: 1, minWidth: 220 }}>
          <strong>Recherche automatique</strong>
          {busy ? " — en cours, tu peux fermer la page" : " — à jour"}
        </Body1>
        <Button icon={running ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} disabled={running} onClick={onRun}>
          {running ? "Mise à jour…" : "Tout mettre à jour"}
        </Button>
      </div>
      {p.active > 0 && <ProgressBar value={pct / 100} style={{ marginTop: 10 }} />}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <Badge appearance="tint" color="success">{p.active ?? "…"} sociétés actives</Badge>
        <Badge appearance="tint" color="brand">{p.fiches ?? 0} fiches prêtes</Badge>
        <Badge appearance="tint" color="informative">{p.with_phone ?? 0} avec un standard</Badge>
        {briefs && <Badge appearance="tint" color="success">{briefs.ready} briefs prêts</Badge>}
        {briefs?.anomalies > 0 && <Badge appearance="tint" color="danger">{briefs.anomalies} avec anomalies</Badge>}
        {queue > 0 && (
          <Badge appearance="outline">
            En recherche : {p.phones_pending || 0} standards et emails · {p.sites_pending || 0} sites · {p.people_pending || 0} décideurs
          </Badge>
        )}
      </div>
      {log && <Caption1 style={{ display: "block", marginTop: 6, color: "var(--colorNeutralForeground2)" }}>{log}</Caption1>}
    </Card>
  );
}

const CONF_COLOR = { "sûr": "#107C10", probable: "#8A6A00", "supposé": "var(--colorNeutralForeground3)" };

// Bilan de la semaine : appels notés (session ou fiche), joignabilité, RDV,
// résultats par verdict du brief. « Copier » donne un texte pour le point hebdo.
function WeekCard({ leads }) {
  const w = useMemo(() => weekStats(leads, today()), [leads]);
  const [copied, setCopied] = useState(false);
  if (!w.calls && !w.emails) return null;
  const fr = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const verdicts = Object.values(w.by_verdict).sort((a, b) => b.calls - a.calls);
  const text = [
    `Bilan prospection du ${fr(w.start)} au ${fr(w.end)}`,
    `- ${w.calls} appels sur ${w.leads_called} sociétés`,
    `- ${w.reached} personnes jointes (${w.reach_rate} %)`,
    `- ${w.rdv} RDV pris (${w.rdv_rate} % des personnes jointes)`,
    `- ${w.no_answer} répondeurs, ${w.not_interested} pas intéressés, ${w.wrong} numéros non attribués`,
    ...(w.emails ? [`- ${w.emails} emails de prospection envoyés, ${w.email_replies} réponses`] : []),
  ].join("\n");
  const tile = (label, value, sub) => (
    <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--colorNeutralBackground3)", minWidth: 110 }}>
      <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground3)" }}>{label}</Caption1>
      <Title3>{value}</Title3>
      {sub && <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>{sub}</Caption1>}
    </div>
  );
  return (
    <Card style={{ padding: "14px 18px", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Body1 style={{ fontWeight: 700 }}>Bilan de la semaine</Body1>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>du {fr(w.start)} au {fr(w.end)}</Caption1>
        <Button size="small" appearance="subtle" style={{ marginLeft: "auto" }}
          onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* ignoré */ } }}>
          {copied ? "Copié" : "Copier le bilan"}
        </Button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tile("Appels", w.calls, `${w.leads_called} sociétés`)}
        {tile("Joints", w.reached, `${w.reach_rate} % des appels`)}
        {tile("RDV", w.rdv, `${w.rdv_rate} % des joints`)}
        {tile("Répondeur", w.no_answer)}
        {tile("Pas intéressé", w.not_interested)}
        {w.wrong > 0 && tile("Faux numéros", w.wrong)}
        {w.emails > 0 && tile("Emails envoyés", w.emails, w.email_replies ? `${w.email_replies} réponse${w.email_replies > 1 ? "s" : ""}` : null)}
      </div>
      <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>
        {w.by_day.map((d) => `${d.label} ${d.calls}`).join(" · ")}
      </Caption1>
      {verdicts.length > 1 && (
        <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>
          Par verdict du brief : {verdicts.map((v) => `${v.label} ${v.reached}/${v.calls} joints, ${v.rdv} RDV`).join(" · ")}
        </Caption1>
      )}
    </Card>
  );
}

// Passage de relais vers l'agent Sales Chat : le fichier de la semaine (un email
// par lead, message prêt) et les instructions à coller une fois dans l'agent.
function SalesChatCard({ leadsCount, onUpdated }) {
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [sentOpen, setSentOpen] = useState(false);
  const [recap, setRecap] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const load = async () => {
    const r = await fetchJson("/api/leads/export?format=json");
    if (r.ok) setStats(r.data);
  };
  useEffect(() => { if (leadsCount) load(); }, [leadsCount]);
  const showInstructions = async () => {
    setOpen((v) => !v);
    if (text) return;
    const r = await fetchJson("/api/leads/agent-instructions");
    if (r.ok) setText(r.data.instructions);
  };
  const saveRecap = async () => {
    setSaving(true); setResult(null);
    const r = await fetchJson("/api/leads/agent-recap", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: recap }),
    });
    setSaving(false);
    setResult(r.ok ? r.data : { error: r.error });
    if (r.ok) { setRecap(""); load(); onUpdated?.(); }
  };
  const s = stats || {};
  return (
    <Card style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Body1 style={{ flex: 1, minWidth: 220 }}>
          <strong>Emails via Sales Chat</strong> — le fichier pour ton agent, puis son récapitulatif en retour
        </Body1>
        <Button as="a" appearance="primary" href={s.rows ? "/api/leads/export" : undefined} disabled={!s.rows}>
          Fichier de la semaine ({s.rows ?? "…"})
        </Button>
        <Button appearance="outline" onClick={() => setRecapOpen((v) => !v)}>Retour de l'agent</Button>
        <Button appearance="outline" onClick={() => setSentOpen((v) => !v)}>Suivi des envois</Button>
        <Button appearance="subtle" onClick={showInstructions}>{open ? "Masquer les instructions" : "Instructions"}</Button>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <Badge appearance="tint" color="success">{s.sur ?? 0} sûrs</Badge>
        <Badge appearance="tint" color="warning">{s.probable ?? 0} probables</Badge>
        <Badge appearance="tint" color="subtle">{s.suppose ?? 0} supposés (validation)</Badge>
        {s.sans_email > 0 && <Badge appearance="outline" title="L'agent les cherche sur le web et dans les contenus Dell ; sinon, à appeler">{s.sans_email} à trouver par l'agent</Badge>}
        {s.sans_nom > 0 && (
          <Badge appearance="outline" color="danger" title="Pas encore de nom de destinataire : la recherche continue ; sinon ajoute un contact sur la fiche (ZoomInfo). Ils ne partent pas sans nom.">
            {s.sans_nom} sans nom (non envoyés)
          </Badge>
        )}
        {s.deja_exportes > 0 && (
          <Button as="a" size="small" appearance="subtle" href="/api/leads/export?all=1">Tout re-télécharger ({s.deja_exportes} déjà traités par l'agent)</Button>
        )}
      </div>
      {sentOpen && <SentEmailsPanel onUpdated={() => { load(); onUpdated?.(); }} />}
      {recapOpen && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <Caption1>
            Colle ici tout le récapitulatif de l'agent (tableau, « Emails trouvés », « Rebonds », « Nouveaux STOP »).
            Les leads traités ne repartent pas avant 25 jours, les emails trouvés sont enregistrés, les rebonds écartés
            et les STOP ne reçoivent plus d'email.
          </Caption1>
          <Textarea value={recap} onChange={(_, d) => setRecap(d.value)} resize="vertical" style={{ minHeight: 160, fontSize: 12.5 }}
            placeholder="| N° | Société | Email | Confiance | Statut | Raison | …" />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button size="small" appearance="primary" disabled={saving || !recap.trim()} onClick={saveRecap}>
              {saving ? "Enregistrement…" : "Enregistrer le retour"}
            </Button>
            {result && !result.error && (
              <Caption1>
                {result.traites} traités · {result.emails_enregistres} emails enregistrés · {result.rebonds} rebonds · {result.stop} STOP
                {result.non_trouves?.length > 0 && ` · non reconnus : ${result.non_trouves.slice(0, 5).join(", ")}${result.non_trouves.length > 5 ? "…" : ""}`}
              </Caption1>
            )}
            {result?.error && <Caption1 style={{ color: "#C50F1F" }}>{result.error}</Caption1>}
          </div>
        </div>
      )}
      {open && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <Caption1>Instructions de départ de l'agent (ton agent Sales Chat a déjà les siennes).</Caption1>
          <Textarea readOnly value={text || "Chargement…"} resize="vertical" style={{ minHeight: 220, fontSize: 12.5 }} />
          <div>
            <Button size="small" disabled={!text} onClick={async () => {
              try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
            }}>{copied ? "Copié" : "Copier les instructions"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Flags({ l }) {
  return (
    <>
      {l.successor && (
        <Caption1 style={{ display: "block", color: l.successor.confidence === "forte" ? "#107C10" : "var(--colorPaletteDarkOrangeForeground1)" }}>
          {l.successor.confidence === "forte" ? "→ Continue sous" : "→ Piste :"} {l.successor.name}
        </Caption1>
      )}
      {(l.flags || []).map((f, i) => (
        <Caption1 key={i} style={{ display: "block", color: "var(--colorPaletteDarkOrangeForeground1)" }}>
          {f.kind === "doublon" && <>⚠ Doublon possible : <Link href={`/accounts/${f.other_id}`}>{f.other_name}</Link></>}
          {f.kind === "groupe" && <>Même groupe ({f.group_name}) : {f.others.join(", ")}</>}
          {f.kind === "filiale" && <>Filiale de <Link href={`/accounts/${f.other_id}`}>{f.other_name}</Link></>}
        </Caption1>
      ))}
    </>
  );
}

function MergeButton({ l, onDone }) {
  const f = (l.flags || []).find((x) => x.kind === "doublon");
  const [busy, setBusy] = useState(false);
  if (!f) return null;
  return (
    <Button size="small" appearance="subtle" disabled={busy} onClick={async () => {
      if (!confirm(`Fusionner « ${f.other_name} » dans « ${l.name} » ?\nLes contacts et notes passent sur « ${l.name} », l'autre compte est supprimé.`)) return;
      setBusy(true);
      const r = await fetchJson("/api/accounts/merge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepId: l.id, dropId: f.other_id }),
      });
      setBusy(false);
      if (!r.ok) { alert(r.error); return; }
      onDone();
    }}>
      {busy ? "Fusion…" : "Fusionner"}
    </Button>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const sfRank = (l) => sfStatusRank(l.sf_lead_status);
const isOpen = isLeadOpen;

// Qui appeler : toujours une personne si on en a une, et toujours le standard
// (son numéro, ou la recherche du numéro en un clic).
function WhoToCall({ l, compact = false }) {
  const c = l.contact;
  const phone = c?.phone || "";
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {c ? (
        <div>
          <Caption1 style={{ display: "block", fontWeight: 600, fontSize: compact ? 13.5 : 12.5 }}>{c.name}</Caption1>
          <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>
            {c.role || "poste à confirmer"}
            {c.kind === "dirigeant" && " · dirigeant"}
            {c.kind === "groupe" && " · maison mère"}
            {l.people_count > 1 && ` · +${l.people_count - 1}`}
          </Caption1>
        </div>
      ) : (
        <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground3)" }}>
          {isOpen(l) ? "Demander le responsable informatique" : "—"}
        </Caption1>
      )}
      {l.email_opt_out ? (
        <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground3)" }}>✉ ne plus écrire (STOP)</Caption1>
      ) : l.email && (
        <Caption1 style={{ display: "block", color: CONF_COLOR[l.email.confidence], wordBreak: "break-all" }}
          title={`${l.email.confidence} — ${l.email.source}`}>
          ✉ {l.email.email} · {l.email.confidence}
        </Caption1>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {phone && <CallButton number={phone} who={`${c.name} — ${l.name}`} />}
        {l.standard ? (
          <CallButton appearance={phone ? "outline" : "primary"} number={l.standard.number} label={`Standard ${l.standard.number}`}
            who={`Standard — ${l.name}`} title={`Standard — ${l.standard.source}`} />
        ) : isOpen(l) ? (
          <Button as="a" size="small" appearance="outline" icon={<Search24Regular />} href={l.phone_search_url} target="_blank" rel="noreferrer"
            title="Ouvre la recherche du numéro ; colle-le ensuite sur la fiche">
            Trouver le standard
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CallBadge({ l }) {
  const st = CALL_STATUS_META[l.call_status];
  return (
    <>
      {st ? <Badge appearance="tint" color={st.color}>{st.label}</Badge> : <Caption1>—</Caption1>}
      {l.recall_at && !isFinalStatus(l.call_status) && (
        <Caption1 style={{ display: "block", color: recallDue(l.recall_at, today()) ? "#C50F1F" : "var(--colorNeutralForeground2)" }}>
          Rappel {new Date(l.recall_at).toLocaleDateString("fr-FR")}
        </Caption1>
      )}
      {l.last_email_at && (
        <Caption1 style={{ display: "block", color: l.email_replied ? "#107C10" : l.email_status === "non_remis" ? "#C50F1F" : "var(--colorNeutralForeground3)" }}>
          ✉ {l.email_replied ? "a répondu" : l.email_status === "non_remis" ? "non remis" : "envoyé"} le {new Date(l.last_email_at).toLocaleDateString("fr-FR")}
        </Caption1>
      )}
      {l.attempts > 0 && (
        <Caption1 style={{ display: "block", color: l.no_answer_streak >= NO_ANSWER_LIMIT ? "#8A6A00" : "var(--colorNeutralForeground3)" }}>
          {l.attempts} appel{l.attempts > 1 ? "s" : ""}
          {l.no_answer_streak >= NO_ANSWER_LIMIT && ` · ${l.no_answer_streak} sans réponse`}
        </Caption1>
      )}
    </>
  );
}

function CompanyCell({ l, onMerged }) {
  const m = HEALTH_META[l.health_status] || { label: "—", color: "subtle" };
  return (
    <>
      <Link href={`/accounts/${l.id}`} style={{ fontWeight: 600 }}>{l.name}</Link>
      <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
        <Badge appearance="tint" color={m.color} size="small" title={l.health_label}>{m.label}</Badge>
        {l.sf_lead_status && (
          <Badge appearance="outline" size="small" color={sfRank(l) === 0 ? "brand" : sfRank(l) === 3 ? "subtle" : "informative"}
            title="Statut du lead dans Salesforce">{sfStatusLabel(l.sf_lead_status)}</Badge>
        )}
        {l.is_new && <Badge appearance="filled" color="brand" size="small">Nouveau</Badge>}
        {l.missing_from_last_import && <Badge appearance="outline" size="small" title="Absent du dernier export Salesforce">Absent</Badge>}
        {l.brief && l.brief.verdict !== "appeler" && (
          <Badge appearance="tint" size="small" color={l.brief.verdict_color} title={l.brief.reason}>{l.brief.verdict_label}</Badge>
        )}
        {l.brief?.anomalies?.length > 0 && (
          <Badge appearance="outline" size="small" color={l.brief.sf_fix ? "danger" : "informative"}
            title={l.brief.anomalies.map((a) => `${a.label}${a.detail ? ` — ${a.detail}` : ""}`).join("\n")}>
            {l.brief.anomalies.length} anomalie{l.brief.anomalies.length > 1 ? "s" : ""}
          </Badge>
        )}
        {l.commune && <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{l.commune}</Caption1>}
      </div>
      <Flags l={l} />
      <MergeButton l={l} onDone={onMerged} />
    </>
  );
}

export default function LeadsClient({ initialLeads = [] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [filter, setFilter] = useState("todo");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");

  async function reload() {
    setLoading(true);
    const r = await fetchJson("/api/leads");
    if (r.ok) setLeads(r.data.leads || []);
    setLoading(false);
  }
  async function loadProgress() {
    const r = await fetchJson("/api/leads/progress");
    if (r.ok) setProgress(r.data);
    return r.ok ? r.data : null;
  }

  // Suivi en direct tant que la recherche tourne (toutes les 30 s).
  useEffect(() => {
    loadProgress();
    const t = setInterval(async () => {
      if (document.hidden) return; // onglet en arrière-plan : on ne sollicite pas le serveur
      const p = await loadProgress();
      if (p && (p.sites_pending || p.people_pending || p.phones_pending || p.collected < p.active)) reload();
    }, 30000);
    return () => clearInterval(t);
  }, []);

  // Tout mettre à jour : doublons + recherches lancées (workers), puis collecte
  // web gratuite compte par compte (fiches régénérées au passage).
  async function runAll() {
    setRunning(true); setLog("Lancement des recherches…");
    const k = await fetchJson("/api/leads/kickoff", { method: "POST" });
    if (k.ok) {
      const parts = [];
      if (k.data.merged?.length) parts.push(`${k.data.merged.length} doublon(s) fusionné(s)`);
      if (k.data.contacts_added) parts.push(`${k.data.contacts_added} contact(s) ajouté(s)`);
      parts.push(k.data.dispatch?.dispatched ? "recherche des standards, sites et décideurs lancée" : "recherche des standards, sites et décideurs dans le quart d'heure");
      setLog(parts.join(" · "));
    }
    let failures = 0;
    for (let i = 0; i < 40; i++) {
      const r = await fetchJson("/api/leads/intel", { method: "POST" });
      if (!r.ok) { if (++failures >= 2) break; continue; }
      failures = 0;
      await loadProgress();
      if (!r.data.results?.length || !r.data.remaining) break;
    }
    // Collecte finie : l'agent met en file la recherche des standards manquants.
    await fetchJson("/api/leads/kickoff", { method: "POST" });
    // Sociétés fermées ou introuvables : recherche du repreneur.
    for (const l of leads.filter((x) => x.health_status === "fermee" || x.health_status === "introuvable").slice(0, 25)) {
      await fetchJson(`/api/accounts/${l.id}/health`, { method: "POST" });
    }
    setRunning(false);
    await loadProgress();
    reload();
  }

  async function afterImport() {
    await reload();
    runAll();
  }

  const counts = useMemo(() => {
    const c = { all: leads.length, todo: 0, recall: 0, nophone: 0, noemail: 0, sffix: 0, rdv: 0, successor: 0, dups: 0, close: 0, missing: 0 };
    for (const l of leads) {
      if (isOpen(l) && !isFinalStatus(l.call_status)) c.todo++;
      if (recallDue(l.recall_at, today()) && !isFinalStatus(l.call_status)) c.recall++;
      if (isOpen(l) && !l.standard && !l.contact?.phone) c.nophone++;
      if (isOpen(l) && !l.email) c.noemail++;
      if (l.brief?.sf_fix) c.sffix++;
      if (l.call_status === "rdv") c.rdv++;
      if (l.successor) c.successor++;
      if ((l.flags || []).length) c.dups++;
      if (l.health_status === "fermee") c.close++;
      if (l.missing_from_last_import) c.missing++;
    }
    return c;
  }, [leads]);

  const shown = sortLeadsByStatus(leads.filter((l) => {
      if (q && !`${l.name} ${l.sirene_name || ""} ${l.contact?.name || ""} ${l.commune || ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "all") return true;
      if (filter === "todo") return isOpen(l) && !isFinalStatus(l.call_status);
      if (filter === "recall") return recallDue(l.recall_at, today()) && !isFinalStatus(l.call_status);
      if (filter === "nophone") return isOpen(l) && !l.standard && !l.contact?.phone;
      if (filter === "noemail") return isOpen(l) && !l.email;
      if (filter === "noname") return isOpen(l) && !l.recipient?.name;
      if (filter === "replied") return !!l.email_replied;
      if (filter === "sffix") return !!l.brief?.sf_fix;
      if (filter === "rdv") return l.call_status === "rdv";
      if (filter === "successor") return !!l.successor;
      if (filter === "dups") return (l.flags || []).length > 0;
      if (filter === "close") return l.health_status === "fermee";
      if (filter === "missing") return l.missing_from_last_import;
      return true;
    }), today());

  const FILTERS = [
    ["todo", "À appeler"],
    ["recall", "À rappeler aujourd'hui"],
    ["nophone", "Sans numéro"],
    ["noemail", "Sans email"],
    ["noname", "Sans nom"],
    ["replied", "Ont répondu par email"],
    ["sffix", "Anomalies à corriger dans Salesforce"],
    ["rdv", "RDV pris"],
    ["successor", "Repris / renommés"],
    ["dups", "Doublons et groupes"],
    ["close", "À clôturer dans Salesforce"],
    ["missing", "Absents du dernier import"],
    ["all", "Tous"],
  ];

  return (
    <div style={{ display: "grid", gap: 16, padding: "8px 0 40px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Title2>Mes leads</Title2>
          <Caption1 style={{ display: "block" }}>
            Pour chaque société : existe-t-elle encore, qui appeler, avec quelle accroche.
          </Caption1>
        </div>
        {leads.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button as="a" appearance="primary" href="/leads/session" icon={<Phone24Regular />}>
              Session d&apos;appels ({buildCallQueue(leads, today()).length})
            </Button>
            <Button as="a" appearance="outline" href="/api/leads/export" icon={<ArrowDownload24Regular />}>
              Fichier Sales Chat
            </Button>
          </div>
        )}
      </div>

      <ImportCard onImported={afterImport} onDeleted={() => { setLeads([]); reload(); loadProgress(); }}
        startOpen={leads.length === 0} existing={leads.length} />

      {leads.length > 0 && (
        <ProgressCard progress={progress} running={running} log={log} onRun={runAll}
          briefs={{ ready: leads.filter((l) => l.brief).length, anomalies: leads.filter((l) => l.brief?.anomalies?.length).length }} />
      )}

      <WeekCard leads={leads} />
      {leads.length > 0 && <SalesChatCard leadsCount={leads.length} onUpdated={reload} />}

      <Card style={{ padding: "16px 16px 20px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {FILTERS.filter(([k]) => k === "todo" || k === "all" || counts[k] > 0).map(([k, label]) => (
            <Button key={k} size="small" appearance={filter === k ? "primary" : "secondary"} onClick={() => setFilter(k)}>
              {label} ({counts[k] || 0})
            </Button>
          ))}
          <Input size="small" contentBefore={<Search24Regular />} placeholder="Société, nom, ville…" value={q}
            onChange={(_, d) => setQ(d.value)} style={{ marginLeft: "auto", minWidth: 200 }} />
          <Button size="small" icon={loading ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} onClick={reload}
            aria-label="Rafraîchir" />
        </div>

        {shown.length === 0 ? (
          <Caption1 style={{ display: "block", marginTop: 16 }}>
            {leads.length ? "Aucun lead dans ce filtre." : "Importe ta liste de leads pour commencer."}
          </Caption1>
        ) : (
          <>
            {/* Grand écran : tableau pleine largeur */}
            <div className="leads-table" style={{ overflowX: "auto", marginTop: 12 }}>
              <Table size="small" aria-label="Leads">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell style={{ width: 52 }}>Prio.</TableHeaderCell>
                    <TableHeaderCell style={{ width: "24%" }}>Société</TableHeaderCell>
                    <TableHeaderCell style={{ width: "28%" }}>Qui appeler</TableHeaderCell>
                    <TableHeaderCell>Accroche</TableHeaderCell>
                    <TableHeaderCell style={{ width: 140 }}>Suivi</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell><PriorityBadge p={l.priority} /></TableCell>
                      <TableCell><CompanyCell l={l} onMerged={reload} /></TableCell>
                      <TableCell style={{ paddingTop: 6, paddingBottom: 6 }}><WhoToCall l={l} /></TableCell>
                      <TableCell>
                        <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>
                          {l.hook || (isOpen(l) ? "En préparation…" : "—")}
                        </Caption1>
                      </TableCell>
                      <TableCell><CallBadge l={l} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Téléphone : une carte par lead, le bouton d'appel sous le pouce */}
            <div className="leads-cards" style={{ marginTop: 12 }}>
              {shown.map((l) => (
                <div key={l.id} className="lead-card">
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <PriorityBadge p={l.priority} />
                    <div style={{ flex: 1, minWidth: 0 }}><CompanyCell l={l} onMerged={reload} /></div>
                    <div style={{ textAlign: "right" }}><CallBadge l={l} /></div>
                  </div>
                  <div style={{ marginTop: 8 }}><WhoToCall l={l} compact /></div>
                  {l.hook && (
                    <Caption1 className="lead-card-hook" style={{ display: "block", marginTop: 8, color: "var(--colorNeutralForeground2)" }}>
                      {l.hook}
                    </Caption1>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
