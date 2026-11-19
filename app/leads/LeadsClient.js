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
import { dedupeByCompany } from "@/lib/salesforce-leads";
import { readLeadsPdf } from "@/lib/salesforce-pdf";
import { HEALTH_META } from "@/lib/dell-qualif";

const BRAND = "#5B53E6";

const BATCH = 6;

function ImportCard({ onImported }) {
  const inputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // { companies, total, rows }
  const [statuses, setStatuses] = useState({ New: true, Working: true, "Closed by Sales": false });
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const stopRef = useRef(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setSummary(null); setParsing(true);
    try {
      const { rows, total } = await readLeadsPdf(file);
      if (!rows.length) throw new Error("Aucun lead reconnu. Est-ce bien l'export « Printable View » d'une liste de leads ?");
      setParsed({ rows, total, companies: dedupeByCompany(rows) });
    } catch (err) {
      setError(err.message);
    } finally {
      setParsing(false);
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
      </div>

      {parsed && (
        <div style={{ marginTop: 16 }}>
          <Caption1>
            {parsed.rows.length} leads lus{parsed.total ? ` sur ${parsed.total} annoncés` : ""} ·{" "}
            {parsed.companies.length} sociétés distinctes
          </Caption1>
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
          Contrôle des sociétés avant l'appel, puis qualification infra + BANT sur la fiche compte.
        </Caption1>
      </div>

      <ImportCard onImported={reload} />

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
                  <TableHeaderCell>Qualif</TableHeaderCell>
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
                        <Caption1>{l.qualif_started ? "En cours" : ""}{l.call_prep_at ? " · appel préparé" : ""}</Caption1>
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
