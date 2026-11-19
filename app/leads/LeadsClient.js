"use client";

import { useMemo, useRef, useState } from "react";
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
import { ArrowUpload24Regular, Search24Regular, ArrowClockwise24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import { dedupeByCompany, parsePastedCompanies } from "@/lib/salesforce-leads";
import { readLeadsPdf } from "@/lib/salesforce-pdf";
import { HEALTH_META } from "@/lib/health-meta";

const BRAND = "#5B53E6";

const BATCH = 6;

function ImportCard({ onImported }) {
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

  return (
    <Card style={{ padding: "20px 20px 22px", borderLeft: `3px solid ${BRAND}` }}>
      <Body1><strong>Importer un export Salesforce (PDF)</strong></Body1>
      <Caption1 style={{ display: "block", marginTop: 4 }}>
        Liste de leads → Printable View → Imprimer en PDF. Chaque société est contrôlée dans SIRENE
        (active ou fermée) et au BODACC (redressement, liquidation). Seuls le nom, le statut et la campagne
        sont conservés.
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
            <Caption1>≈ {Math.ceil(selected.length * 1.2 / 60)} min · gratuit (API publiques, aucun appel IA)</Caption1>
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

// Préparation en lot des fiches d'approche (IA + web), un compte après l'autre.
// S'arrête seul sur une erreur de budget ou d'API répétée.
function BatchPrepCard({ leads, onDone }) {
  const todo = leads.filter((l) => l.health_status === "active" && !/closed/i.test(l.sf_lead_status || "") && !l.call_prep_at);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState([]);
  const stopRef = useRef(false);

  async function run() {
    const list = todo;
    setRunning(true); setDone(0); setTotal(list.length); setLog([]); stopRef.current = false;
    let failuresInRow = 0;
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) break;
      const r = await fetchJson("/api/call-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: list[i].id }),
      });
      setDone(i + 1);
      if (!r.ok) {
        failuresInRow++;
        setLog((l) => [`${list[i].name} : ${r.error}`, ...l].slice(0, 6));
        if (r.status === 429 || failuresInRow >= 2) {
          setLog((l) => ["Arrêt : erreur répétée ou plafond budgétaire atteint.", ...l]);
          break;
        }
      } else {
        failuresInRow = 0;
        const n = r.data?.prep?.contacts?.length || 0;
        setLog((l) => [`${list[i].name} : ${n} interlocuteur(s)`, ...l].slice(0, 6));
      }
    }
    setRunning(false);
    onDone();
  }

  return (
    <Card style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Body1><strong>Fiches d'approche</strong></Body1>
        <Caption1 style={{ flex: 1, minWidth: 220 }}>
          Pour chaque compte à appeler : interlocuteurs IT, standard, email, actu, email + LinkedIn + relance prêts.
          ≈ 1 min et ≈ 0,10 € par compte, sous ton plafond budgétaire.
        </Caption1>
        <Button appearance="primary" disabled={running || !todo.length} onClick={run}>
          {todo.length ? `Préparer ${todo.length} compte(s)` : "Tout est préparé"}
        </Button>
        {running && <Button onClick={() => { stopRef.current = true; }}>Arrêter</Button>}
      </div>
      {(running || done > 0) && (
        <div style={{ marginTop: 10 }}>
          <ProgressBar value={total ? done / total : 0} />
          <Caption1>{done} / {total}{running ? " — garde cette page ouverte" : ""}</Caption1>
          {log.map((x, i) => <Caption1 key={i} style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>{x}</Caption1>)}
        </div>
      )}
    </Card>
  );
}

export default function LeadsClient({ initialLeads = [] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [filter, setFilter] = useState("todo");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    const r = await fetchJson("/api/leads");
    if (r.ok) setLeads(r.data.leads || []);
    setLoading(false);
  }

  const counts = useMemo(() => {
    const c = { all: leads.length, todo: 0 };
    for (const l of leads) {
      c[l.health_status] = (c[l.health_status] || 0) + 1;
      if (l.health_status === "active" && !/closed/i.test(l.sf_lead_status || "")) c.todo++;
    }
    return c;
  }, [leads]);

  const shown = leads.filter((l) => {
    if (q && !l.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "todo") return l.health_status === "active" && !/closed/i.test(l.sf_lead_status || "");
    return l.health_status === filter;
  });

  const FILTERS = [
    ["todo", "À appeler"],
    ["vigilance", HEALTH_META.vigilance.label],
    ["fermee", "À clôturer dans Salesforce"],
    ["introuvable", HEALTH_META.introuvable.label],
    ["all", "Tous"],
  ];

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1100, margin: "0 auto", padding: "8px 0 40px" }}>
      <div>
        <Title2>Leads Salesforce</Title2>
        <Caption1 style={{ display: "block" }}>
          Contrôle des sociétés, puis fiche d'approche par compte : interlocuteurs, coordonnées et messages prêts.
        </Caption1>
      </div>

      <ImportCard onImported={reload} />

      {leads.length > 0 && <BatchPrepCard leads={leads} onDone={reload} />}

      <Card style={{ padding: "16px 16px 20px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {FILTERS.map(([k, label]) => (
            <Button key={k} size="small" appearance={filter === k ? "primary" : "secondary"} onClick={() => setFilter(k)}>
              {label} ({counts[k] || 0})
            </Button>
          ))}
          <Input size="small" contentBefore={<Search24Regular />} placeholder="Filtrer…" value={q}
            onChange={(_, d) => setQ(d.value)} style={{ marginLeft: "auto", minWidth: 180 }} />
          <Button size="small" icon={loading ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} onClick={reload}
            aria-label="Rafraîchir" />
        </div>

        {shown.length === 0 ? (
          <Caption1 style={{ display: "block", marginTop: 16 }}>
            {leads.length ? "Aucun lead dans ce filtre." : "Aucun lead importé pour l'instant."}
          </Caption1>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <Table size="small" aria-label="Leads Salesforce">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Société (Salesforce)</TableHeaderCell>
                  <TableHeaderCell>Santé</TableHeaderCell>
                  <TableHeaderCell>SIRENE</TableHeaderCell>
                  <TableHeaderCell>Lead</TableHeaderCell>
                  <TableHeaderCell>Fiche d'approche</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((l) => {
                  const m = HEALTH_META[l.health_status] || { label: "—", color: "subtle" };
                  return (
                    <TableRow key={l.id}>
                      <TableCell><Link href={`/accounts/${l.id}`}>{l.name}</Link></TableCell>
                      <TableCell>
                        <Badge appearance="tint" color={m.color} title={l.health_label}>{m.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Caption1>
                          {l.sirene_name ? `${l.sirene_name}${l.commune ? ` · ${l.commune}` : ""}` : "—"}
                          {l.match_confidence === "probable" ? " (?)" : ""}
                        </Caption1>
                      </TableCell>
                      <TableCell><Caption1>{l.sf_lead_status}{l.sf_campaign ? ` · ${l.sf_campaign}` : ""}</Caption1></TableCell>
                      <TableCell>
                        <Caption1>
                          {l.call_prep_at
                            ? `${l.contacts_found} interlocuteur(s)${l.standard_phone ? ` · ${l.standard_phone}` : ""}`
                            : "—"}
                        </Caption1>
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
