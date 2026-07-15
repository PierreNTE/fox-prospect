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
  Table,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
  TableHeaderCell,
} from "@fluentui/react-components";
import {
  Search24Regular,
  Dismiss24Regular,
  ArrowImport24Regular,
} from "@fluentui/react-icons";
import { SkeletonTableRows, SkeletonFunnelCards } from "@/components/Skeleton";
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

// Les données initiales arrivent du composant serveur (rendu SSR : déjà dans le
// HTML, aucune attente réseau au premier affichage). Les rafraîchissements
// (après changement de statut) repassent par l'API.
export default function DashboardClient({ initialProspects = null }) {
  const router = useRouter();
  const [prospects, setProspects] = useState(initialProspects);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("tous");
  const [sortBy, setSortBy] = useState("recent");
  const [minScore, setMinScore] = useState(0);
  const [visibleCount, setVisibleCount] = useState(50); // pagination « voir plus »

  const load = async () => {
    const res = await fetch("/api/prospects", { cache: "no-store" });
    const data = await res.json();
    if (data.error) setError(data.error);
    else setProspects(data.prospects);
  };

  const setStatus = async (id, status) => {
    setError("");
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) setError(data.error || `Erreur ${res.status}.`);
    load();
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
  const visible = filtered.slice(0, visibleCount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title2>Mes prospects</Title2>
          <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
            Du premier contact au rendez-vous.
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
              Aucun prospect pour l'instant. Pars d'un compte pour identifier ses décideurs, ou importe une liste.
            </Body1>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <Button appearance="primary" icon={<ArrowImport24Regular />} onClick={() => router.push("/accounts")}>
                Voir mes comptes
              </Button>
              <Button appearance="outline" icon={<ArrowImport24Regular />} onClick={() => router.push("/import")}>
                Importer des prospects
              </Button>
            </div>
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
                      {p.email ? (
                        <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: BRAND, textDecoration: "none" }}>
                          {p.email}
                        </a>
                      ) : p.phone ? (
                        <a href={`tel:${(p.phone || "").replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: GREEN, fontWeight: 600, textDecoration: "none" }}>
                          {p.phone}
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
