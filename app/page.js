"use client";

import { useEffect, useMemo, useState } from "react";
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
  Search24Regular,
  ArrowSort24Regular,
  Dismiss24Regular,
  Flash24Regular,
  ArrowRight24Regular,
  ArrowImport24Regular,
} from "@fluentui/react-icons";
import { SkeletonLine, SkeletonTableRows, SkeletonFunnelCards } from "@/components/Skeleton";
import {
  STATUS_ORDER, STATUS_LABELS,
  dataQualityLevel, DATA_QUALITY_LABELS,
} from "@/lib/constants";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const AMBER = "#F6A623";
const RED = "#C50F1F";
const BLUE = "#0078D4";

const SORT_OPTIONS = [
  { value: "recent", label: "Récents d'abord" },
  { value: "score", label: "Score ↓" },
  { value: "name", label: "Nom A → Z" },
  { value: "company", label: "Entreprise A → Z" },
];

// Couleur de chaque étape du funnel commercial (du plus froid au plus chaud).
const STAGE_COLORS = {
  non_contacte: "var(--colorNeutralForeground3)",
  contacte: BLUE,
  en_cours: AMBER,
  interesse: "#E8730C",
  refuse: RED,
  client: GREEN,
};

const NBA_COLORS = {
  prepare_rdv: GREEN, avancer: GREEN, fideliser: GREEN, appeler: GREEN,
  relance_urgente: RED, relance: AMBER, relance_prevue: RED,
  generer: BRAND, enrichir: "#8e44ad",
  envoyer: BRAND, rechercher: BRAND,
  opt_out: "var(--colorNeutralForeground3)", archive: "var(--colorNeutralForeground3)",
};

// Pastille de qualité de la donnée (dérivée — cf. lib/constants.dataQualityLevel).
function QualityDot({ prospect }) {
  const level = dataQualityLevel(prospect);
  const color = level === "verifie" ? GREEN : level === "a_confirmer" ? AMBER : RED;
  return (
    <span
      title={DATA_QUALITY_LABELS[level]}
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }}
    />
  );
}

// Puce de relance — visible dans la liste, colorée selon l'échéance.
function RelanceChip({ date, action }) {
  if (!date) return null;
  const today = new Date().toISOString().slice(0, 10);
  const color = date < today ? RED : date === today ? "#E8730C" : "var(--colorNeutralForeground3)";
  const d = new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return (
    <span title={action ? `Relance : ${action}` : "Relance prévue"}
      style={{ fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 4, padding: "0 5px", whiteSpace: "nowrap" }}>
      ⏰ {d}
    </span>
  );
}

function ScoreBadge({ score }) {
  if (score == null) return <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>—</Caption1>;
  const color = score >= 70 ? GREEN : score >= 40 ? AMBER : RED;
  return <span style={{ fontWeight: 700, fontSize: 14, color }}>{score}</span>;
}

function NbaChip({ nba }) {
  const color = NBA_COLORS[nba.action] || BRAND;
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 700,
      padding: "2px 8px", borderRadius: 12,
      background: color, color: "#fff", whiteSpace: "nowrap",
    }}>
      {nba.label}
    </span>
  );
}

// Cache mémoire (persiste pendant la session, vidé au rechargement complet) :
// au retour sur le tableau de bord, la liste s'affiche instantanément depuis le
// cache puis se rafraîchit en arrière-plan — fini le skeleton à chaque navigation.
let prospectsCache = null;
let prioritiesCache = null;

export default function Dashboard() {
  const router = useRouter();
  const [prospects, setProspects] = useState(prospectsCache);
  const [priorities, setPriorities] = useState(prioritiesCache);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("tous");
  const [sortBy, setSortBy] = useState("recent");
  const [minScore, setMinScore] = useState(0);
  const [showPriorities, setShowPriorities] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50); // pagination « voir plus »

  const load = async () => {
    const res = await fetch("/api/prospects", { cache: "no-store" });
    const data = await res.json();
    if (data.error) setError(data.error);
    else { prospectsCache = data.prospects; setProspects(data.prospects); }
  };

  const loadPriorities = async () => {
    const res = await fetch("/api/prospects/priorities", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const d = await res.json().catch(() => ({}));
    if (d.priorities) { prioritiesCache = d.priorities; setPriorities(d.priorities); }
  };

  useEffect(() => { load(); loadPriorities(); }, []);

  const setStatus = async (id, status) => {
    setError("");
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) setError(data.error || `Erreur ${res.status}.`);
    load(); loadPriorities();
  };

  const counts = useMemo(() => {
    const c = { tous: 0 };
    for (const s of STATUS_ORDER) c[s] = 0;
    (prospects || []).forEach((p) => { c[p.status] = (c[p.status] || 0) + 1; c.tous++; });
    return c;
  }, [prospects]);

  const filtered = useMemo(() => {
    let list = prospects || [];
    if (q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter((p) =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(lq) ||
        (p.company || "").toLowerCase().includes(lq) ||
        (p.role || "").toLowerCase().includes(lq)
      );
    }
    if (filterStatus !== "tous") list = list.filter((p) => p.status === filterStatus);
    if (minScore > 0) list = list.filter((p) => (p.fit_score || 0) >= minScore);
    const sorted = [...list];
    if (sortBy === "score") sorted.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
    else if (sortBy === "name") sorted.sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr"));
    else if (sortBy === "company") sorted.sort((a, b) => (a.company || "").localeCompare(b.company || "", "fr"));
    return sorted;
  }, [prospects, q, filterStatus, sortBy, minScore]);

  // Réinitialise la pagination quand les filtres/tri changent.
  useEffect(() => { setVisibleCount(50); }, [q, filterStatus, sortBy, minScore]);

  const hasFilters = q.trim() || filterStatus !== "tous" || minScore > 0;
  const topPriorities = (priorities || []).filter((p) => p.nba.priority >= 50);
  const visible = filtered.slice(0, visibleCount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title2>La piste</Title2>
          <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
            Tes prospects, du sourcing au rendez-vous.
          </Body1>
        </div>
        <Button appearance="outline" icon={<ArrowImport24Regular />} onClick={() => router.push("/import")}>
          Importer
        </Button>
      </div>

      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── Pipeline funnel ── */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
        {prospects === null ? <SkeletonFunnelCards count={6} /> : STATUS_ORDER.map((s) => {
          const active = filterStatus === s;
          const color = STAGE_COLORS[s];
          return (
            <Card
              key={s}
              onClick={() => setFilterStatus(active ? "tous" : s)}
              style={{
                flex: "1 1 100px", minWidth: 90, padding: "12px 14px", cursor: "pointer",
                borderBottom: active ? `3px solid ${color}` : "3px solid transparent",
                transition: "border-color .15s",
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 800, color: counts[s] > 0 ? color : "var(--colorNeutralForeground3)", lineHeight: 1 }}>
                {counts[s] ?? 0}
              </div>
              <Caption1 style={{ color: "var(--colorNeutralForeground2)", marginTop: 4, display: "block" }}>
                {STATUS_LABELS[s]}
              </Caption1>
            </Card>
          );
        })}
      </div>

      {/* ── Priorités du jour ── */}
      {topPriorities.length > 0 && (
        <Card style={{ padding: "16px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showPriorities ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Flash24Regular style={{ color: AMBER }} />
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Priorités du jour</Body1>
              <Badge appearance="filled" color="warning">{topPriorities.length}</Badge>
            </div>
            <Button appearance="subtle" size="small" onClick={() => setShowPriorities((v) => !v)}>
              {showPriorities ? "Masquer" : "Afficher"}
            </Button>
          </div>
          {showPriorities && topPriorities.slice(0, 6).map((p, i) => (
            <div
              key={p.id}
              onClick={() => router.push(`/prospects/${p.id}`)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 0",
                borderTop: i > 0 ? "1px solid var(--colorNeutralStroke2)" : "none",
                cursor: "pointer",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Body1 style={{ fontWeight: 700 }}>{p.first_name} {p.last_name}</Body1>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginLeft: 6 }}>{p.company}</Caption1>
                {p.nba.reason && (
                  <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 2 }}>
                    {p.nba.reason}
                  </Caption1>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <NbaChip nba={p.nba} />
                <ScoreBadge score={p.fit_score} />
                <ArrowRight24Regular style={{ fontSize: 16, color: "var(--colorNeutralForeground3)" }} />
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* ── Prospects list ── */}
      <Card style={{ padding: "0" }}>
        <div style={{ padding: "12px 16px 12px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
          <Input
            placeholder="Rechercher par nom, entreprise, poste…"
            value={q}
            onChange={(_, d) => setQ(d.value)}
            contentBefore={<Search24Regular />}
            style={{ flex: "1 1 200px", minWidth: 160 }}
          />
          <Select value={sortBy} onChange={(_, d) => setSortBy(d.value)} style={{ width: "auto" }}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={minScore} onChange={(_, d) => setMinScore(+d.value)} style={{ width: "auto" }}>
            <option value={0}>Tous les scores</option>
            <option value={70}>Score ≥ 70</option>
            <option value={40}>Score ≥ 40</option>
          </Select>
          {hasFilters && (
            <Button appearance="subtle" size="small" icon={<Dismiss24Regular />}
              onClick={() => { setQ(""); setFilterStatus("tous"); setMinScore(0); }}>
              Réinitialiser
            </Button>
          )}
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginLeft: "auto", whiteSpace: "nowrap" }}>
            {filtered.length} / {(prospects || []).length}
          </Caption1>
        </div>

        {prospects === null ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody><SkeletonTableRows rows={8} cols={5} /></tbody>
          </table>
        ) : prospects.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <Body1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginBottom: 16 }}>
              Aucun prospect sur la piste pour l'instant.
            </Body1>
            <Button appearance="primary" icon={<ArrowImport24Regular />} onClick={() => router.push("/import")}>
              Importer mes premiers prospects
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Aucun prospect ne correspond aux filtres actifs.</Caption1>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Contact</TableHeaderCell>
                <TableHeaderCell>Poste</TableHeaderCell>
                <TableHeaderCell>Entreprise</TableHeaderCell>
                <TableHeaderCell
                  style={{ cursor: "pointer", userSelect: "none" }}
                  onClick={() => setSortBy(sortBy === "score" ? "recent" : "score")}
                >
                  Fit {sortBy === "score" && "▼"}
                </TableHeaderCell>
                <TableHeaderCell>Statut</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.id} style={{ cursor: "pointer" }}>
                  <TableCell onClick={() => router.push(`/prospects/${p.id}`)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Body1 style={{ fontWeight: 600 }}>{p.first_name} {p.last_name}</Body1>
                      {p.do_not_contact && (
                        <span title="Ne pas contacter" style={{ fontSize: 10, fontWeight: 700, color: RED, border: `1px solid ${RED}`, borderRadius: 4, padding: "0 4px" }}>
                          🚫
                        </span>
                      )}
                      <RelanceChip date={p.follow_up_at} action={p.next_action} />
                    </div>
                    <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                      <QualityDot prospect={p} />
                      {p.phone ? (
                        <a href={`tel:${(p.phone || "").replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: GREEN, fontWeight: 600, textDecoration: "none" }}>
                          {p.phone}
                        </a>
                      ) : p.email ? (
                        <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: BRAND, textDecoration: "none" }}>
                          {p.email}
                        </a>
                      ) : (
                        <Caption1 style={{ fontSize: 11, color: RED }}>⚠ sans coordonnée</Caption1>
                      )}
                    </div>
                  </TableCell>
                  <TableCell onClick={() => router.push(`/prospects/${p.id}`)}>
                    <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{p.role || "—"}</Caption1>
                  </TableCell>
                  <TableCell onClick={() => router.push(`/prospects/${p.id}`)}>
                    <Body1>{p.company}</Body1>
                  </TableCell>
                  <TableCell onClick={() => router.push(`/prospects/${p.id}`)}>
                    <ScoreBadge score={p.fit_score} />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={p.status}
                      onChange={(_, d) => setStatus(p.id, d.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: "auto" }}
                    >
                      {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {prospects !== null && filtered.length > visibleCount && (
          <div style={{ padding: "12px 16px", textAlign: "center", borderTop: "1px solid var(--colorNeutralStroke2)" }}>
            <Button appearance="subtle" onClick={() => setVisibleCount((n) => n + 50)}>
              Voir plus ({filtered.length - visibleCount} restant{filtered.length - visibleCount > 1 ? "s" : ""})
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
