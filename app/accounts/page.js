"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Button,
  Input,
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
  Add24Regular,
  BuildingMultiple24Regular,
  Fire24Regular,
  ArrowSync24Regular,
  Search24Regular,
  DataTrending24Regular,
  ArrowClockwise24Regular,
  Stop24Regular,
  CalendarSync24Regular,
} from "@fluentui/react-icons";
import { SkeletonTableRows, SkeletonAccountCards } from "@/components/Skeleton";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const AMBER = "#F6A623";
const RED = "#C50F1F";

function heatColor(score) {
  if (score >= 70) return RED;
  if (score >= 40) return AMBER;
  return GREEN;
}

function HeatBadge({ score }) {
  if (score == null) return <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>—</Caption1>;
  return (
    <span style={{ fontWeight: 700, color: heatColor(score), fontSize: 14 }}>{score}</span>
  );
}

function HotAccountCard({ account, onClick }) {
  const topSignal = account.signals?.[0];
  return (
    <Card
      onClick={onClick}
      style={{ cursor: "pointer", padding: "12px 16px" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <HeatBadge score={account.heat_score} />
            <Body1 style={{ fontWeight: 700 }}>{account.name}</Body1>
            {account.sector && (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{account.sector}</Caption1>
            )}
          </div>
          {topSignal && (
            <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 4 }}>
              <span style={{ textTransform: "capitalize" }}>{topSignal.type}</span>
              {" · "}{topSignal.detail?.slice(0, 90)}{topSignal.detail?.length > 90 ? "…" : ""}
            </Caption1>
          )}
        </div>
        {account.signals_count > 0 && (
          <Badge appearance="outline" color="warning">
            {account.signals_count} signal{account.signals_count > 1 ? "s" : ""}
          </Badge>
        )}
      </div>
    </Card>
  );
}

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState(null);
  const [hotAccounts, setHotAccounts] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [batch, setBatch] = useState(null);
  const [queuing, setQueuing] = useState(false);
  const [queuedMsg, setQueuedMsg] = useState("");
  const [sireneTotal, setSireneTotal] = useState(null);
  const [sirenePage, setSirenePage] = useState(1);
  const [sireneImporting, setSireneImporting] = useState(false);
  const [sireneResult, setSireneResult] = useState(null);
  const [sireneHasMore, setSireneHasMore] = useState(true);
  const stopRef = useRef(false);

  const load = async () => {
    const res = await fetch("/api/accounts");
    const d = await res.json();
    if (d.error) setError(d.error);
    else setAccounts(d.accounts);
    return d.accounts || [];
  };

  const loadHot = async () => {
    const res = await fetch("/api/accounts/heat?limit=8");
    const d = await res.json();
    if (!d.error) setHotAccounts(d.accounts || []);
  };

  const loadSireneTotal = async () => {
    const res = await fetch("/api/companies/import").catch(() => null);
    if (!res?.ok) return;
    const d = await res.json().catch(() => ({}));
    if (d.total !== undefined) setSireneTotal(d.total);
  };

  useEffect(() => { load(); loadHot(); loadSireneTotal(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setError("");
    const res = await fetch("/api/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    router.push(`/accounts/${d.account.id}`);
  };

  const seed = async () => {
    setSeeding(true); setError("");
    const res = await fetch("/api/accounts/seed", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setSeeding(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    await load(); await loadHot();
  };

  const importSirene = async () => {
    setSireneImporting(true); setSireneResult(null); setError("");
    // Crée de vrais COMPTES (ICP-filtrés) prêts à scraper/analyser, pas seulement
    // des lignes firmographiques. limit=25 nouveaux comptes par clic.
    const res = await fetch("/api/accounts/import-sirene", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ categories: ["ETI", "GE"], page: sirenePage, limit: 25 }),
    });
    const d = await res.json().catch(() => ({}));
    setSireneImporting(false);
    if (d.error) { setError(d.error); return; }
    setSireneResult(d);
    setSirenePage(d.next_page || sirenePage + 1);
    setSireneHasMore(d.has_more ?? false);
    setSireneTotal((t) => (t ?? 0) + (d.imported || 0));
    await load(); await loadHot(); // les nouveaux comptes apparaissent dans la liste
  };

  const runBatch = async () => {
    const all = await load();
    const queue = all.filter((a) => !a.last_refreshed_at).map((a) => ({ id: a.id, name: a.name }));
    if (queue.length === 0) {
      setBatch({ total: 0, done: 0, message: "Tous les comptes ont déjà été analysés." });
      return;
    }
    stopRef.current = false;
    setBatch({ total: queue.length, done: 0, queue, currentId: null, currentName: null, message: "" });
    let done = 0;
    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) {
        setBatch((b) => ({ ...b, currentId: null, currentName: null, message: `Arrêté. ${done}/${queue.length} analysés.` }));
        return;
      }
      const item = queue[i];
      setBatch((b) => ({ ...b, currentId: item.id, currentName: item.name, queue: queue.slice(i + 1) }));
      try {
        const res = await fetch("/api/accounts/analyze", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: item.id }),
        });
        if (res.status === 429) {
          await load();
          setBatch({ total: queue.length, done, currentId: null, currentName: null, queue: [],
            message: `Plafond quotidien atteint après ${done} analyse(s). Reprendra demain.` });
          return;
        }
        if (res.ok) done++;
      } catch {}
      await load();
      setBatch((b) => ({ ...b, done }));
    }
    await loadHot();
    setBatch((b) => ({ ...b, currentId: null, currentName: null, message: `Terminé : ${done}/${queue.length} comptes analysés.` }));
  };

  const enqueueAll = async () => {
    const all = await load();
    const pending = all.filter((a) => !a.last_refreshed_at);
    if (pending.length === 0) { setQueuedMsg("Tous les comptes ont déjà été analysés."); return; }
    setQueuing(true); setQueuedMsg("");
    const res = await fetch("/api/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "analyze_account", items: pending.map((a) => ({ account_id: a.id })) }),
    });
    const d = await res.json().catch(() => ({}));
    setQueuing(false);
    if (d.error) { setError(d.error); return; }
    setQueuedMsg(`${d.enqueued} compte(s) planifié(s) — le cron les analysera à 5h.`);
  };

  const filtered = (accounts || []).filter((a) =>
    a.name.toLowerCase().includes(q.toLowerCase()) || (a.sector || "").toLowerCase().includes(q.toLowerCase())
  );
  const notAnalyzed = (accounts || []).filter((a) => !a.last_refreshed_at).length;
  const running = batch?.currentId;
  const hotVisible = hotAccounts?.filter((a) => a.heat_score > 0).length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title2>Comptes</Title2>
          <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
            Cartographie des organisations IT, signaux stratégiques et contacts décideurs.
          </Body1>
        </div>
        <Button appearance="primary" icon={<Add24Regular />} onClick={() => document.getElementById("new-account-name")?.focus()}>
          Nouveau compte
        </Button>
      </div>

      {/* ── Error ── */}
      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── Hot accounts ── */}
      {hotVisible && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Fire24Regular style={{ color: RED }} />
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Comptes chauds</Body1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginLeft: 4 }}>
              triés par score de chaleur des signaux
            </Caption1>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {hotAccounts.filter((a) => a.heat_score > 0).map((a) => (
              <HotAccountCard key={a.id} account={a} onClick={() => router.push(`/accounts/${a.id}`)} />
            ))}
          </div>
        </Card>
      )}

      {/* ── Create account ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <BuildingMultiple24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Analyser un nouveau compte</Body1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Input
            id="new-account-name"
            placeholder="Nom de l'entreprise (ex. Coopérative U)"
            value={name}
            onChange={(_, d) => setName(d.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            style={{ flex: 1, minWidth: 240 }}
          />
          <Button appearance="primary" disabled={busy || !name.trim()} onClick={create}
            icon={busy ? <Spinner size="tiny" /> : <Add24Regular />}>
            Créer le compte
          </Button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <Button appearance="outline" disabled={seeding || !!running} onClick={seed}
            icon={seeding ? <Spinner size="tiny" /> : <DataTrending24Regular />}>
            Importer les grands comptes français
          </Button>
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
            Ajoute ~50 grandes entreprises FR (sans les analyser).
          </Caption1>
        </div>
      </Card>

      {/* ── Batch analysis ── */}
      {accounts && accounts.length > 0 && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ArrowSync24Regular style={{ color: BRAND }} />
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Recherche en lot</Body1>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!running && (
                <Button appearance="primary" disabled={notAnalyzed === 0} onClick={runBatch}
                  icon={<ArrowClockwise24Regular />}>
                  Analyser les {notAnalyzed} compte(s) en attente
                </Button>
              )}
              {running && (
                <Button appearance="outline" onClick={() => { stopRef.current = true; }} icon={<Stop24Regular />}>
                  Stopper
                </Button>
              )}
            </div>
          </div>

          {batch && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {running && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Spinner size="tiny" />
                  <Body1>Analyse : <strong>{batch.currentName}</strong></Body1>
                  <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{batch.done}/{batch.total}</Caption1>
                </div>
              )}
              {batch.message && <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{batch.message}</Caption1>}
              {running && batch.queue?.length > 0 && (
                <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                  À venir : {batch.queue.slice(0, 4).map((x) => x.name).join(", ")}
                  {batch.queue.length > 4 && ` … (+${batch.queue.length - 4})`}
                </Caption1>
              )}
            </div>
          )}

          {!batch && (
            <>
              <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginBottom: 10 }}>
                <strong>Option A (onglet ouvert) :</strong> analyse immédiate, progression visible ci-dessus.{" "}
                <strong>Option B (fond) :</strong> planifie dans la file — tu peux fermer l'onglet.
              </Caption1>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Button appearance="outline" disabled={queuing || notAnalyzed === 0} onClick={enqueueAll}
                  icon={queuing ? <Spinner size="tiny" /> : <CalendarSync24Regular />}>
                  Planifier {notAnalyzed} compte(s) en fond
                </Button>
                {queuedMsg && (
                  <Caption1 style={{ color: GREEN }}>{queuedMsg}</Caption1>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── SIRENE import ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <Body1 style={{ fontWeight: 700, fontSize: 15, display: "block", marginBottom: 4 }}>Ajouter des comptes cibles (SIRENE)</Body1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Crée de nouveaux comptes ETI/GE filtrés sur ton ICP (NAF, effectif),
              prêts à scraper et qualifier. Source : API officielle INSEE/SIRENE.
              Veille auto désactivée par défaut (budget) — active-la par compte si besoin.
              {accounts != null && (
                <> · <strong style={{ color: "var(--colorNeutralForeground1)" }}>{accounts.length.toLocaleString("fr-FR")}</strong> compte(s) en base.</>
              )}
            </Caption1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Button appearance="outline" disabled={sireneImporting || !sireneHasMore} onClick={importSirene}
              icon={sireneImporting ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />}>
              {sireneImporting ? "Import en cours…" : sireneHasMore ? "Importer ~25 comptes" : "Import terminé"}
            </Button>
            {sireneResult && !sireneImporting && (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                +{sireneResult.imported} compte(s){sireneResult.duplicates ? ` · ${sireneResult.duplicates} déjà connu(s)` : ""}{sireneResult.skipped_icp ? ` · ${sireneResult.skipped_icp} hors ICP` : ""}
              </Caption1>
            )}
          </div>
        </div>
      </Card>

      {/* ── Accounts table ── */}
      {accounts && accounts.length > 0 && (
        <Card style={{ padding: "16px 0 0" }}>
          <div style={{ padding: "0 16px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <Input
              placeholder="Filtrer par nom ou secteur…"
              value={q}
              onChange={(_, d) => setQ(d.value)}
              contentBefore={<Search24Regular />}
              style={{ flex: 1, maxWidth: 360 }}
            />
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginLeft: "auto" }}>
              {filtered.length} / {accounts.length}
            </Caption1>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Entreprise</TableHeaderCell>
                <TableHeaderCell>Secteur</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }}>Chaleur</TableHeaderCell>
                <TableHeaderCell>Signaux</TableHeaderCell>
                <TableHeaderCell>Dernière veille</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const hot = hotAccounts?.find((h) => h.id === a.id);
                return (
                  <TableRow
                    key={a.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => router.push(`/accounts/${a.id}`)}
                  >
                    <TableCell>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Body1 style={{ fontWeight: 600 }}>{a.name}</Body1>
                        {batch?.currentId === a.id && <Spinner size="tiny" />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{a.sector || "—"}</Caption1>
                    </TableCell>
                    <TableCell style={{ textAlign: "right" }}>
                      {hot ? <HeatBadge score={hot.heat_score} /> : <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>—</Caption1>}
                    </TableCell>
                    <TableCell>
                      <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>
                        {(a.signals || []).length || "—"}
                      </Caption1>
                    </TableCell>
                    <TableCell>
                      <Caption1 style={{ color: a.last_refreshed_at ? "var(--colorNeutralForeground2)" : "var(--colorNeutralForeground4)" }}>
                        {a.last_refreshed_at
                          ? new Date(a.last_refreshed_at).toLocaleDateString("fr-FR")
                          : "en attente"}
                      </Caption1>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {accounts && accounts.length === 0 && (
        <Card style={{ padding: "40px 24px", textAlign: "center" }}>
          <BuildingMultiple24Regular style={{ fontSize: 40, color: "var(--colorNeutralForeground3)", display: "block", margin: "0 auto 12px" }} />
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>
            Aucun compte pour l'instant. Crée-en un ou importe les grands comptes français.
          </Body1>
        </Card>
      )}

      {!accounts && !error && (
        <Card style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonAccountCards count={6} />
        </Card>
      )}
    </div>
  );
}
