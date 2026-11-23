"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Card,
  Button,
  Title2,
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
import { ArrowUpload24Regular, Search24Regular, ArrowClockwise24Regular, Phone24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import { dedupeByCompany, parsePastedCompanies } from "@/lib/salesforce-leads";
import { readLeadsPdf } from "@/lib/salesforce-pdf";
import { HEALTH_META } from "@/lib/health-meta";
import { CALL_STATUS_META, isFinalStatus, recallDue } from "@/lib/call-status";

const BRAND = "#5B53E6";

const BATCH = 6;

function ImportCard({ onImported, startOpen = true }) {
  const [open, setOpen] = useState(startOpen);
  const inputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [ocrStep, setOcrStep] = useState(null); // { page, pages } pendant la lecture OCR
  const [parsed, setParsed] = useState(null); // { companies, total, rows }
  const [statuses, setStatuses] = useState({ New: true, Working: true, "Closed by Sales": false });
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
    setRunning(true); setDone(0); setError(null); stopRef.current = false;
    const tally = { active: 0, vigilance: 0, fermee: 0, introuvable: 0, erreurs: 0 };
    for (let i = 0; i < selected.length; i += BATCH) {
      if (stopRef.current) break;
      const leads = selected.slice(i, i + BATCH).map(({ company, status, campaign }) => ({ company, status, campaign }));
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
      <div>
        <Button appearance="primary" icon={<ArrowUpload24Regular />} onClick={() => setOpen(true)}>
          Importer la liste de la semaine
        </Button>
      </div>
    );
  }

  return (
    <Card style={{ padding: "20px 20px 22px", borderLeft: `3px solid ${BRAND}` }}>
      <Body1><strong>Importer un export Salesforce (PDF)</strong></Body1>
      <Caption1 style={{ display: "block", marginTop: 4 }}>
        Liste de leads → Printable View → Imprimer en PDF. Chaque société est contrôlée (active, fermée,
        reprise sous un autre nom), puis la recherche du contact et de l'accroche démarre automatiquement.
        Seuls le nom, le statut et la campagne sont conservés.
      </Caption1>

      <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={onFile} />
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Button appearance="primary" icon={<ArrowUpload24Regular />} disabled={parsing || running}
          onClick={() => inputRef.current?.click()}>
          {parsing ? "Lecture du PDF…" : "Choisir le PDF"}
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
          {`Pages : ${diag.pages} · fragments de texte : ${diag.textItems} · en-tête trouvé : ${diag.headerFound ? "oui" : "non"}`}
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

// Avancement de la recherche automatique (après import, puis toutes les 2 h).
// Un seul bouton : tout mettre à jour maintenant (collecte + repreneurs + recherches).
function ProgressCard({ progress, running, log, onRun }) {
  const p = progress || {};
  const busy = running || p.sites_pending > 0 || p.people_pending > 0 || (p.active && p.collected < p.active);
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
        <Badge appearance="tint" color="informative">{p.with_contact ?? 0} avec un contact nommé</Badge>
        {(p.sites_pending > 0 || p.people_pending > 0) && (
          <Badge appearance="outline">Recherche en file : {p.sites_pending || 0} sites · {p.people_pending || 0} décideurs</Badge>
        )}
      </div>
      {log && <Caption1 style={{ display: "block", marginTop: 6, color: "var(--colorNeutralForeground2)" }}>{log}</Caption1>}
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
const isOpen = (l) => ["active", "vigilance"].includes(l.health_status) && !/closed/i.test(l.sf_lead_status || "");

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
      if (p && (p.sites_pending || p.people_pending || p.collected < p.active)) reload();
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
      parts.push(k.data.dispatch?.dispatched ? "recherche des sites et décideurs lancée" : "recherche des sites et décideurs au prochain passage (≤ 6 h)");
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
    const c = { all: leads.length, todo: 0, recall: 0, rdv: 0, successor: 0, dups: 0, close: 0, missing: 0 };
    for (const l of leads) {
      if (isOpen(l) && !isFinalStatus(l.call_status)) c.todo++;
      if (recallDue(l.recall_at, today()) && !isFinalStatus(l.call_status)) c.recall++;
      if (l.call_status === "rdv") c.rdv++;
      if (l.successor) c.successor++;
      if ((l.flags || []).length) c.dups++;
      if (l.health_status === "fermee") c.close++;
      if (l.missing_from_last_import) c.missing++;
    }
    return c;
  }, [leads]);

  const shown = leads
    .filter((l) => {
      if (q && !`${l.name} ${l.sirene_name || ""} ${l.contact?.name || ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "all") return true;
      if (filter === "todo") return isOpen(l) && !isFinalStatus(l.call_status);
      if (filter === "recall") return recallDue(l.recall_at, today()) && !isFinalStatus(l.call_status);
      if (filter === "rdv") return l.call_status === "rdv";
      if (filter === "successor") return !!l.successor;
      if (filter === "dups") return (l.flags || []).length > 0;
      if (filter === "close") return l.health_status === "fermee";
      if (filter === "missing") return l.missing_from_last_import;
      return true;
    })
    // À rappeler aujourd'hui en tête, puis l'ordre de priorité.
    .sort((a, b) => Number(recallDue(b.recall_at, today())) - Number(recallDue(a.recall_at, today())));

  const FILTERS = [
    ["todo", "À appeler"],
    ["recall", "À rappeler aujourd'hui"],
    ["rdv", "RDV pris"],
    ["successor", "Repris / renommés"],
    ["dups", "Doublons et groupes"],
    ["close", "À clôturer dans Salesforce"],
    ["missing", "Absents du dernier import"],
    ["all", "Tous"],
  ];

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1100, margin: "0 auto", padding: "8px 0 40px" }}>
      <div>
        <Title2>Mes leads</Title2>
        <Caption1 style={{ display: "block" }}>
          Pour chaque société : existe-t-elle encore, qui appeler, avec quelle accroche.
        </Caption1>
      </div>

      <ImportCard onImported={afterImport} startOpen={leads.length === 0} />

      {leads.length > 0 && <ProgressCard progress={progress} running={running} log={log} onRun={runAll} />}

      <Card style={{ padding: "16px 16px 20px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {FILTERS.filter(([k]) => k === "todo" || k === "all" || counts[k] > 0).map(([k, label]) => (
            <Button key={k} size="small" appearance={filter === k ? "primary" : "secondary"} onClick={() => setFilter(k)}>
              {label} ({counts[k] || 0})
            </Button>
          ))}
          <Input size="small" contentBefore={<Search24Regular />} placeholder="Chercher une société ou un nom…" value={q}
            onChange={(_, d) => setQ(d.value)} style={{ marginLeft: "auto", minWidth: 200 }} />
          <Button size="small" icon={loading ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} onClick={reload}
            aria-label="Rafraîchir" />
        </div>

        {shown.length === 0 ? (
          <Caption1 style={{ display: "block", marginTop: 16 }}>
            {leads.length ? "Aucun lead dans ce filtre." : "Importe ta liste de leads pour commencer."}
          </Caption1>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <Table size="small" aria-label="Leads">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell style={{ width: 56 }}>Prio.</TableHeaderCell>
                  <TableHeaderCell>Société</TableHeaderCell>
                  <TableHeaderCell>Qui appeler</TableHeaderCell>
                  <TableHeaderCell>Accroche</TableHeaderCell>
                  <TableHeaderCell style={{ width: 150 }}>Suivi</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((l) => {
                  const m = HEALTH_META[l.health_status] || { label: "—", color: "subtle" };
                  const st = CALL_STATUS_META[l.call_status];
                  const phone = l.standard_phone || l.intel?.phone || "";
                  return (
                    <TableRow key={l.id}>
                      <TableCell><PriorityBadge p={l.priority} /></TableCell>
                      <TableCell>
                        <Link href={`/accounts/${l.id}`} style={{ fontWeight: 600 }}>{l.name}</Link>
                        <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                          <Badge appearance="tint" color={m.color} size="small" title={l.health_label}>{m.label}</Badge>
                          {l.is_new && <Badge appearance="filled" color="brand" size="small">Nouveau</Badge>}
                          {l.missing_from_last_import && <Badge appearance="outline" size="small" title="Absent du dernier export Salesforce">Absent</Badge>}
                        </div>
                        <Flags l={l} />
                        <MergeButton l={l} onDone={reload} />
                      </TableCell>
                      <TableCell>
                        {l.contact ? (
                          <>
                            <Caption1 style={{ display: "block", fontWeight: 600 }}>{l.contact.name}</Caption1>
                            <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>{l.contact.role}</Caption1>
                          </>
                        ) : (
                          <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground3)" }}>
                            {l.call_prep_at ? "Demander au standard" : isOpen(l) ? "Recherche en cours…" : "—"}
                          </Caption1>
                        )}
                        {phone && (
                          <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5 }}>
                            <Phone24Regular style={{ fontSize: 14 }} /> {phone}
                          </a>
                        )}
                      </TableCell>
                      <TableCell>
                        <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)", maxWidth: 360 }}>
                          {l.hook || (isOpen(l) ? "En préparation…" : "—")}
                        </Caption1>
                      </TableCell>
                      <TableCell>
                        {st ? <Badge appearance="tint" color={st.color}>{st.label}</Badge> : <Caption1>—</Caption1>}
                        {l.recall_at && !isFinalStatus(l.call_status) && (
                          <Caption1 style={{ display: "block", color: recallDue(l.recall_at, today()) ? "#C50F1F" : "var(--colorNeutralForeground2)" }}>
                            Rappel {new Date(l.recall_at).toLocaleDateString("fr-FR")}
                          </Caption1>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
