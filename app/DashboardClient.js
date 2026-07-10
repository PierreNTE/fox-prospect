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
  Checkbox,
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
  Flash24Regular,
  ArrowRight24Regular,
  ArrowImport24Regular,
} from "@fluentui/react-icons";
import { SkeletonTableRows, SkeletonFunnelCards } from "@/components/Skeleton";
import {
  STATUS_ORDER, STATUS_LABELS,
  dataQualityLevel, DATA_QUALITY_LABELS,
} from "@/lib/constants";
import { COLORS, STAGE_COLORS, NBA_COLORS, scoreColor } from "@/lib/design-tokens";

const { brand: BRAND, success: GREEN, warning: AMBER, danger: RED } = COLORS;

const SORT_OPTIONS = [
  { value: "recent", label: "Récents d'abord" },
  { value: "score", label: "Score ↓" },
  { value: "name", label: "Nom A → Z" },
  { value: "company", label: "Entreprise A → Z" },
];

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
  const color = date < today ? RED : date === today ? COLORS.accent : COLORS.neutral;
  const d = new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return (
    <span title={action ? `Relance : ${action}` : "Relance prévue"}
      style={{ fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 4, padding: "0 5px", whiteSpace: "nowrap" }}>
      ⏰ {d}
    </span>
  );
}

function ScoreBadge({ score }) {
  if (score == null) return <Caption1 style={{ color: COLORS.neutral }}>—</Caption1>;
  return <span style={{ fontWeight: 700, fontSize: 14, color: scoreColor(score) }}>{score}</span>;
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

function TagChip({ tag, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
        cursor: "pointer",
        border: `1px solid ${active ? BRAND : "var(--colorNeutralStroke2)"}`,
        background: active ? BRAND : "transparent",
        color: active ? "#fff" : "var(--colorNeutralForeground2)",
      }}
    >
      {tag}
    </button>
  );
}

// Le « pourquoi » d'une priorité : le signal source (BOAMP, France Travail,
// qualification), daté — plus besoin d'ouvrir la fiche pour comprendre.
function TopSignal({ signal }) {
  if (!signal?.detail) return null;
  const date = signal.date || signal.observed_at || "";
  return (
    <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 2 }}>
      📡 {signal.type ? `${signal.type} · ` : ""}{String(signal.detail).slice(0, 110)}{date ? ` (${date})` : ""}
    </Caption1>
  );
}

// Les données initiales arrivent du composant serveur (rendu SSR : déjà dans le
// HTML, aucune attente réseau au premier affichage). Les rafraîchissements
// (après mutation) repassent par l'API.
export default function DashboardClient({ initialProspects = null, initialPriorities = null }) {
  const router = useRouter();
  const [prospects, setProspects] = useState(initialProspects);
  const [priorities, setPriorities] = useState(initialPriorities);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("tous");
  const [sortBy, setSortBy] = useState("recent");
  const [minScore, setMinScore] = useState(0);
  const [tagFilter, setTagFilter] = useState("");
  const [showPriorities, setShowPriorities] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50); // pagination « voir plus »

  // ── Sélection & actions en masse ──
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [bulkTag, setBulkTag] = useState("");

  // ── Vues sauvegardées ──
  const [views, setViews] = useState([]);

  const load = async () => {
    const res = await fetch("/api/prospects", { cache: "no-store" });
    const data = await res.json();
    if (data.error) setError(data.error);
    else setProspects(data.prospects);
  };

  const loadPriorities = async () => {
    const res = await fetch("/api/prospects/priorities", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const d = await res.json().catch(() => ({}));
    if (d.priorities) setPriorities(d.priorities);
  };

  useEffect(() => {
    fetch("/api/views", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { views: [] }))
      .then((d) => setViews(d.views || []))
      .catch(() => {});
  }, []);

  const setStatus = async (id, status) => {
    setError("");
    // Optimistic update : le Select reflète le choix immédiatement.
    setProspects((list) => (list || []).map((p) => (p.id === id ? { ...p, status } : p)));
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) { setError(data.error || `Erreur ${res.status}.`); load(); }
    loadPriorities();
  };

  // « Reporter 7 j » sur une priorité : pose une relance, la NBA la fera
  // remonter à l'échéance au lieu de la représenter chaque matin.
  const snooze = async (id) => {
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await fetch(`/api/prospects/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ follow_up_at: date }),
    }).catch(() => {});
    loadPriorities();
  };

  const bulk = async (action, value) => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/prospects/bulk", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [...selected], action, value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) setError(data.error || `Erreur ${res.status}.`);
    else if (action === "qualify") setError(`✓ ${data.enqueued} qualification(s) en file — traitées par la veille sous plafond budget.`);
    setBusy(false);
    setSelected(new Set());
    load(); loadPriorities();
  };

  const saveView = async () => {
    const name = window.prompt("Nom de la vue :", "");
    if (!name?.trim()) return;
    const res = await fetch("/api/views", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, filters: { q, status: filterStatus, minScore, tag: tagFilter, sortBy } }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.view) setViews((v) => [...v, d.view]);
  };

  const applyView = (id) => {
    const view = views.find((v) => v.id === id);
    if (!view) return;
    const f = view.filters || {};
    setQ(f.q || "");
    setFilterStatus(f.status || "tous");
    setMinScore(f.minScore || 0);
    setTagFilter(f.tag || "");
    setSortBy(f.sortBy || "recent");
  };

  const counts = useMemo(() => {
    const c = { tous: 0 };
    for (const s of STATUS_ORDER) c[s] = 0;
    (prospects || []).forEach((p) => { c[p.status] = (c[p.status] || 0) + 1; c.tous++; });
    return c;
  }, [prospects]);

  const allTags = useMemo(() => {
    const t = new Set();
    (prospects || []).forEach((p) => (p.tags || []).forEach((x) => t.add(x)));
    return [...t].sort();
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
    if (tagFilter) list = list.filter((p) => (p.tags || []).includes(tagFilter));
    const sorted = [...list];
    if (sortBy === "score") sorted.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
    else if (sortBy === "name") sorted.sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr"));
    else if (sortBy === "company") sorted.sort((a, b) => (a.company || "").localeCompare(b.company || "", "fr"));
    return sorted;
  }, [prospects, q, filterStatus, sortBy, minScore, tagFilter]);

  // Réinitialise pagination et sélection quand les filtres/tri changent.
  useEffect(() => { setVisibleCount(50); setSelected(new Set()); }, [q, filterStatus, sortBy, minScore, tagFilter]);

  const hasFilters = q.trim() || filterStatus !== "tous" || minScore > 0 || tagFilter;
  const topPriorities = (priorities || []).filter((p) => p.nba.priority >= 50);
  const visible = filtered.slice(0, visibleCount);
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((p) => p.id)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title2>La piste</Title2>
          <Body1 style={{ color: COLORS.neutral, display: "block", marginTop: 2 }}>
            Tes prospects, du sourcing au rendez-vous.
          </Body1>
        </div>
        <Button appearance="outline" icon={<ArrowImport24Regular />} onClick={() => router.push("/import")}>
          Importer
        </Button>
      </div>

      {error && (
        <Card style={{ borderLeft: `3px solid ${error.startsWith("✓") ? GREEN : RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: error.startsWith("✓") ? GREEN : RED }}>{error}</Body1>
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
              <div style={{ fontSize: 24, fontWeight: 800, color: counts[s] > 0 ? color : COLORS.neutral, lineHeight: 1 }}>
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
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Aujourd'hui</Body1>
              <Badge appearance="filled" color="warning">{topPriorities.length}</Badge>
            </div>
            <Button appearance="subtle" size="small" onClick={() => setShowPriorities((v) => !v)}>
              {showPriorities ? "Masquer" : "Afficher"}
            </Button>
          </div>
          {showPriorities && topPriorities.slice(0, 6).map((p, i) => (
            <div
              key={p.id}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 0",
                borderTop: i > 0 ? "1px solid var(--colorNeutralStroke2)" : "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => router.push(`/prospects/${p.id}`)}>
                <Body1 style={{ fontWeight: 700 }}>{p.first_name} {p.last_name}</Body1>
                <Caption1 style={{ color: COLORS.neutral, marginLeft: 6 }}>{p.company}</Caption1>
                {p.nba.reason && (
                  <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 2 }}>
                    {p.nba.reason}
                  </Caption1>
                )}
                <TopSignal signal={p.top_signal} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <Button appearance="subtle" size="small" title="Reporter de 7 jours"
                  onClick={(e) => { e.stopPropagation(); snooze(p.id); }}>
                  ⏰ 7 j
                </Button>
                <NbaChip nba={p.nba} />
                <ScoreBadge score={p.fit_score} />
                <ArrowRight24Regular
                  style={{ fontSize: 16, color: COLORS.neutral, cursor: "pointer" }}
                  onClick={() => router.push(`/prospects/${p.id}`)}
                />
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
          {views.length > 0 && (
            <Select value="" onChange={(_, d) => d.value && applyView(d.value)} style={{ width: "auto" }} title="Vues sauvegardées">
              <option value="">Vues…</option>
              {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
          {hasFilters && (
            <>
              <Button appearance="subtle" size="small" onClick={saveView}>Enregistrer la vue</Button>
              <Button appearance="subtle" size="small" icon={<Dismiss24Regular />}
                onClick={() => { setQ(""); setFilterStatus("tous"); setMinScore(0); setTagFilter(""); }}>
                Réinitialiser
              </Button>
            </>
          )}
          <Caption1 style={{ color: COLORS.neutral, marginLeft: "auto", whiteSpace: "nowrap" }}>
            {filtered.length} / {(prospects || []).length}
          </Caption1>
        </div>

        {allTags.length > 0 && (
          <div style={{ padding: "8px 16px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
            <Caption1 style={{ color: COLORS.neutral }}>Tags :</Caption1>
            {allTags.map((t) => (
              <TagChip key={t} tag={t} active={tagFilter === t}
                onClick={() => setTagFilter(tagFilter === t ? "" : t)} />
            ))}
          </div>
        )}

        {/* ── Barre d'actions en masse ── */}
        {selected.size > 0 && (
          <div style={{
            padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
            background: `color-mix(in srgb, ${BRAND} 8%, var(--colorNeutralBackground1))`,
            borderBottom: "1px solid var(--colorNeutralStroke2)",
          }}>
            <Body1 style={{ fontWeight: 700 }}>{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</Body1>
            <Select value="" onChange={(_, d) => d.value && bulk("set_status", d.value)} disabled={busy} style={{ width: "auto" }}>
              <option value="">Changer le statut…</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </Select>
            <Input
              placeholder="Ajouter un tag…"
              value={bulkTag}
              onChange={(_, d) => setBulkTag(d.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && bulkTag.trim()) { bulk("add_tag", bulkTag.trim()); setBulkTag(""); }
              }}
              style={{ width: 160 }}
              disabled={busy}
            />
            <Button appearance="primary" size="small" disabled={busy} onClick={() => bulk("qualify")}>
              Qualifier ({selected.size})
            </Button>
            <Button appearance="subtle" size="small" onClick={() => setSelected(new Set())}>Annuler</Button>
          </div>
        )}

        {prospects === null ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody><SkeletonTableRows rows={8} cols={6} /></tbody>
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
            <Caption1 style={{ color: COLORS.neutral }}>Aucun prospect ne correspond aux filtres actifs.</Caption1>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: 36 }}>
                  <Checkbox checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Tout sélectionner" />
                </TableHeaderCell>
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                      aria-label={`Sélectionner ${p.first_name} ${p.last_name}`} />
                  </TableCell>
                  <TableCell onClick={() => router.push(`/prospects/${p.id}`)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Body1 style={{ fontWeight: 600 }}>{p.first_name} {p.last_name}</Body1>
                      {p.do_not_contact && (
                        <span title="Ne pas contacter" style={{ fontSize: 10, fontWeight: 700, color: RED, border: `1px solid ${RED}`, borderRadius: 4, padding: "0 4px" }}>
                          🚫
                        </span>
                      )}
                      <RelanceChip date={p.follow_up_at} action={p.next_action} />
                      {(p.tags || []).map((t) => (
                        <span key={t} style={{ fontSize: 10, fontWeight: 600, color: BRAND, border: `1px solid ${BRAND}`, borderRadius: 8, padding: "0 6px" }}>
                          {t}
                        </span>
                      ))}
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
