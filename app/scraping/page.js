"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Button,
  Input,
  Select,
  Title2,
  Body1,
  Caption1,
  Badge,
  Spinner,
  Table,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
  TableHeaderCell,
} from "@fluentui/react-components";
import {
  Globe24Regular,
  Play24Regular,
  CheckmarkCircle24Regular,
  ErrorCircle24Regular,
  LinkSquare24Regular,
} from "@fluentui/react-icons";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const RED = "#C50F1F";
const AMBER = "#F6A623";
const BLUE = "#0078D4";

const KIND_LABELS = {
  discover: "Découvrir (noms + LinkedIn)",
  discover_and_enrich: "Découvrir + enrichir (email)",
  enrich: "Enrichir l'existant (email)",
};

function StatusBadge({ status }) {
  const map = {
    pending: { color: "informative", label: "en attente" },
    running: { color: "warning", label: "en cours" },
    done: { color: "success", label: "terminé" },
    error: { color: "danger", label: "erreur" },
  };
  const s = map[status] || map.pending;
  return <Badge appearance="tint" color={s.color}>{s.label}</Badge>;
}

function ProgressBar({ value }) {
  return (
    <div style={{ height: 6, background: "var(--colorNeutralBackground3)", borderRadius: 3, overflow: "hidden", minWidth: 80 }}>
      <div style={{ width: `${value || 0}%`, height: "100%", background: BRAND, transition: "width 0.4s ease", borderRadius: 3 }} />
    </div>
  );
}

export default function ScrapingPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [company, setCompany] = useState("");
  const [kind, setKind] = useState("discover_and_enrich");
  const [limit, setLimit] = useState(8);
  const [launching, setLaunching] = useState(false);
  const [qualifying, setQualifying] = useState(null);
  const pollRef = useRef(null);

  const loadJobs = async () => {
    const res = await fetch("/api/scrape/jobs");
    const d = await res.json().catch(() => ({}));
    if (!d.error) setJobs(d.jobs || []);
    return d.jobs || [];
  };

  const loadSelected = async (id) => {
    const res = await fetch(`/api/scrape/jobs/${id}`);
    const d = await res.json().catch(() => ({}));
    if (!d.error) setSelected(d);
  };

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {});
    loadJobs();
  }, []);

  useEffect(() => {
    const active = jobs.some((j) => j.status === "running" || j.status === "pending");
    if (active && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        await loadJobs();
        if (selected?.job?.id) await loadSelected(selected.job.id);
      }, 5000);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
    return () => { if (pollRef.current && !active) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [jobs, selected]);

  const launch = async () => {
    setError(""); setInfo("");
    if (!accountId && !company.trim()) { setError("Choisis un compte ou saisis une entreprise."); return; }
    setLaunching(true);
    const res = await fetch("/api/scrape/enqueue", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_id: accountId || null, company: company.trim(), kind, limit: Number(limit) }),
    });
    const d = await res.json().catch(() => ({}));
    setLaunching(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    setInfo(d.dispatched
      ? "Job lancé — le worker démarre dans quelques secondes."
      : "Job mis en file — traité au prochain passage du cron (PAT GitHub non configuré).");
    await loadJobs();
    if (d.job?.id) loadSelected(d.job.id);
  };

  const qualifyOne = async (result) => {
    setQualifying(result.id); setError(""); setInfo("");
    try {
      const pr = await fetch("/api/scrape/promote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ result_id: result.id }),
      });
      const pd = await pr.json().catch(() => ({}));
      if (!pr.ok) { setError(pd.error || "Promotion impossible."); return false; }
      const prospectId = pd.prospect?.id || pd.prospect_id;
      const rr = await fetch("/api/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId }),
      });
      if (rr.status === 429) { setError("Plafond quotidien atteint — qualification reprise demain."); return false; }
      return true;
    } finally {
      setQualifying(null);
      if (selected?.job?.id) loadSelected(selected.job.id);
    }
  };

  const qualifyAll = async () => {
    const todo = (selected?.results || []).filter((r) => !r.prospect_id);
    for (const r of todo) { const ok = await qualifyOne(r); if (!ok) break; }
    setInfo("Qualification en lot terminée (ou stoppée au plafond).");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div>
        <Title2>Scraping</Title2>
        <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
          Découverte de décideurs + enrichissement, exécutés par le worker GitHub Actions. Progression en direct.
        </Body1>
      </div>

      {/* ── Feedback ── */}
      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <ErrorCircle24Regular style={{ color: RED, flexShrink: 0 }} />
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}
      {info && (
        <Card style={{ borderLeft: `3px solid ${GREEN}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <CheckmarkCircle24Regular style={{ color: GREEN, flexShrink: 0 }} />
          <Body1 style={{ color: GREEN }}>{info}</Body1>
        </Card>
      )}

      {/* ── Launch form ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Globe24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Lancer un scraping</Body1>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 16 }}>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Compte cible</Caption1>
            <Select value={accountId} onChange={(_, d) => setAccountId(d.value)}>
              <option value="">— saisie libre ci-dessous —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>… ou entreprise (texte)</Caption1>
            <Input
              placeholder="ex. Decathlon"
              value={company}
              onChange={(_, d) => setCompany(d.value)}
              disabled={!!accountId}
            />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Type</Caption1>
            <Select value={kind} onChange={(_, d) => setKind(d.value)}>
              {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Profils max</Caption1>
            <Input
              type="number"
              min="1"
              max="20"
              value={String(limit)}
              onChange={(_, d) => setLimit(d.value)}
            />
          </div>
        </div>
        <Button
          appearance="primary"
          icon={launching ? <Spinner size="tiny" /> : <Play24Regular />}
          disabled={launching}
          onClick={launch}
        >
          Lancer
        </Button>
      </Card>

      {/* ── Jobs table ── */}
      <Card style={{ padding: "0" }}>
        <div style={{ padding: "16px 20px 10px" }}>
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Jobs</Body1>
        </div>
        {jobs.length === 0 ? (
          <div style={{ padding: "0 20px 20px" }}>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Aucun job pour l'instant.</Caption1>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Cible</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Statut</TableHeaderCell>
                <TableHeaderCell>Progression</TableHeaderCell>
                <TableHeaderCell>Résultats</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => {
                const st = j.stats || {};
                return (
                  <TableRow key={j.id} style={{ cursor: "pointer" }} onClick={() => loadSelected(j.id)}>
                    <TableCell>
                      <Body1 style={{ fontWeight: 600 }}>{j.params?.company || j.params?.account_id || "—"}</Body1>
                    </TableCell>
                    <TableCell>
                      <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{KIND_LABELS[j.kind] || j.kind}</Caption1>
                    </TableCell>
                    <TableCell><StatusBadge status={j.status} /></TableCell>
                    <TableCell><ProgressBar value={j.progress} /></TableCell>
                    <TableCell>
                      <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>
                        {st.found ?? 0} trouvé{(st.found ?? 0) > 1 ? "s" : ""}
                        {st.enriched ? ` · ${st.enriched} email` : ""}
                        {st.blocked ? ` · ${st.blocked} bloqué` : ""}
                      </Caption1>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ── Selected job results ── */}
      {selected?.job && (
        <Card style={{ padding: "0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 10px", flexWrap: "wrap", gap: 8 }}>
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>
              Résultats — {selected.job.params?.company || selected.job.params?.account_id}
            </Body1>
            {(selected.results || []).some((r) => !r.prospect_id) && (
              <Button appearance="outline" size="small" disabled={!!qualifying} onClick={qualifyAll}
                icon={qualifying ? <Spinner size="tiny" /> : undefined}>
                Tout qualifier
              </Button>
            )}
          </div>

          {selected.job.error && (
            <Card style={{ borderLeft: `3px solid ${RED}`, padding: "10px 12px", margin: "0 20px 12px" }}>
              <Caption1 style={{ color: RED }}>{selected.job.error}</Caption1>
            </Card>
          )}

          {(selected.results || []).length === 0 ? (
            <div style={{ padding: "0 20px 20px" }}>
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                {selected.job.status === "running" ? "En cours…" : "Aucun contact (source bloquée ou rien trouvé)."}
              </Caption1>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Nom</TableHeaderCell>
                  <TableHeaderCell>Poste</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Source</TableHeaderCell>
                  <TableHeaderCell></TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selected.results.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Body1 style={{ fontWeight: 600 }}>{r.full_name || "—"}</Body1>
                        {r.linkedin_url && (
                          <a href={r.linkedin_url} target="_blank" rel="noreferrer"
                            style={{ color: "#0077b5", display: "flex" }} onClick={(e) => e.stopPropagation()}>
                            <LinkSquare24Regular style={{ fontSize: 16 }} />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{r.title || "—"}</Caption1>
                    </TableCell>
                    <TableCell>
                      {r.email ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{r.email}</Caption1>
                          {r.email_confidence && <Badge appearance="outline" size="small">{r.email_confidence}</Badge>}
                        </div>
                      ) : (
                        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>—</Caption1>
                      )}
                    </TableCell>
                    <TableCell>
                      <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{r.source}</Caption1>
                    </TableCell>
                    <TableCell style={{ textAlign: "right" }}>
                      {r.prospect_id ? (
                        <Badge appearance="tint" color="success" icon={<CheckmarkCircle24Regular />}>qualifié</Badge>
                      ) : (
                        <Button appearance="outline" size="small" disabled={qualifying === r.id}
                          icon={qualifying === r.id ? <Spinner size="tiny" /> : undefined}
                          onClick={() => qualifyOne(r)}>
                          Qualifier
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
