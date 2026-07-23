"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card, Button, Input, Select, Checkbox, Title2, Body1, Caption1, Spinner,
} from "@fluentui/react-components";
import {
  Add24Regular, Delete24Regular, CalendarLtr24Regular, ArrowClockwise24Regular,
} from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const AMBER = "#F6A623";
const RED = "#C50F1F";

const KIND_LABEL = { appel: "Appel", email: "E-mail", linkedin: "LinkedIn", rdv: "RDV", relance: "Relance", autre: "Tâche" };
const KIND_COLOR = { appel: GREEN, email: BRAND, linkedin: "#0077b5", rdv: "#E8730C", relance: AMBER, autre: "var(--colorNeutralForeground3)" };

const todayStr = () => new Date().toISOString().slice(0, 10);

function fmt(d) {
  if (!d) return "Sans date";
  try { return new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" }); }
  catch { return d; }
}

function bucketOf(date, t) {
  if (!date) return "nodate";
  if (date < t) return "overdue";
  if (date === t) return "today";
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  if (date <= in7) return "week";
  return "later";
}

const BUCKETS = [
  { key: "overdue", label: "En retard", color: RED },
  { key: "today", label: "Aujourd'hui", color: "#E8730C" },
  { key: "week", label: "Cette semaine", color: AMBER },
  { key: "later", label: "Plus tard", color: "var(--colorNeutralForeground3)" },
  { key: "nodate", label: "Sans échéance", color: "var(--colorNeutralForeground3)" },
];

export default function AgendaClient({ initial }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial?.tasks || []);
  const relances = initial?.relances || [];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(todayStr());
  const [kind, setKind] = useState("appel");

  const refresh = async () => {
    const { ok, data, error: err } = await fetchJson("/api/tasks", { cache: "no-store" });
    if (ok) setTasks(data.tasks || []); else setError(err);
  };

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true); setError("");
    const { ok, error: err } = await fetchJson("/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim(), kind, due_date: due || null }),
    });
    setBusy(false);
    if (!ok) { setError(err); return; }
    setTitle("");
    await refresh();
  };

  const toggle = async (task) => {
    const before = tasks;
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    const { ok, error: err } = await fetchJson(`/api/tasks/${task.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ done: !task.done }),
    });
    if (!ok) { setError(err); setTasks(before); }
  };

  const remove = async (task) => {
    if (!confirm("Supprimer cette tâche ?")) return;
    const before = tasks;
    setTasks((list) => list.filter((t) => t.id !== task.id));
    const { ok, error: err } = await fetchJson(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (!ok) { setError(err); setTasks(before); }
  };

  // Fusionne les tâches ouvertes et les relances (prospects.follow_up_at) en
  // items datés, groupés par échéance.
  const grouped = useMemo(() => {
    const t = todayStr();
    const items = [];
    for (const task of tasks) {
      if (task.done) continue;
      items.push({
        itemType: "task", raw: task, id: task.id, title: task.title, date: task.due_date, kind: task.kind,
        link: task.prospect_id ? `/prospects/${task.prospect_id}` : task.account_id ? `/accounts/${task.account_id}` : null,
        sub: task.notes || "",
      });
    }
    for (const p of relances) {
      items.push({
        itemType: "relance", id: `r-${p.id}`,
        title: `${p.first_name} ${p.last_name}${p.company ? ` — ${p.company}` : ""}`,
        date: p.follow_up_at, kind: "relance", link: `/prospects/${p.id}`, sub: p.next_action || "Relance prévue",
      });
    }
    const by = {};
    for (const b of BUCKETS) by[b.key] = [];
    for (const it of items) by[bucketOf(it.date, t)].push(it);
    for (const k of Object.keys(by)) by[k].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    return by;
  }, [tasks, relances]);

  const doneTasks = tasks.filter((t) => t.done);
  const openCount = BUCKETS.reduce((n, b) => n + grouped[b.key].length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <Title2>Agenda</Title2>
          <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
            Toutes tes échéances au même endroit — tâches et relances.
          </Body1>
        </div>
        <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={refresh}>Rafraîchir</Button>
      </div>

      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* Ajout rapide */}
      <Card style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 240px", minWidth: 180 }}>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Nouvelle tâche</Caption1>
            <Input value={title} onChange={(_, d) => setTitle(d.value)} placeholder="Ex. rappeler la DSI d'Acme"
              onKeyDown={(e) => e.key === "Enter" && add()} style={{ width: "100%" }} />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Échéance</Caption1>
            <Input type="date" value={due} onChange={(_, d) => setDue(d.value)} />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Type</Caption1>
            <Select value={kind} onChange={(_, d) => setKind(d.value)}>
              <option value="appel">Appel</option>
              <option value="email">E-mail</option>
              <option value="linkedin">LinkedIn</option>
              <option value="rdv">RDV</option>
              <option value="autre">Autre</option>
            </Select>
          </div>
          <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Add24Regular />}
            disabled={busy || !title.trim()} onClick={add}>
            Ajouter
          </Button>
        </div>
      </Card>

      {openCount === 0 && (
        <Card style={{ padding: "32px 24px", textAlign: "center" }}>
          <CalendarLtr24Regular style={{ fontSize: 36, color: "var(--colorNeutralForeground3)", display: "block", margin: "0 auto 10px" }} />
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>
            Aucune échéance ouverte. Ajoute une tâche, ou planifie une relance depuis une fiche prospect.
          </Body1>
        </Card>
      )}

      {BUCKETS.map((b) => grouped[b.key].length > 0 && (
        <Card key={b.key} style={{ padding: "16px 18px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: b.color }} />
            <Body1 style={{ fontWeight: 700, fontSize: 14 }}>{b.label}</Body1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{grouped[b.key].length}</Caption1>
          </div>
          {grouped[b.key].map((it) => (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--colorNeutralStroke2)" }}>
              {it.itemType === "task" ? (
                <Checkbox checked={false} onChange={() => toggle(it.raw)} aria-label="Marquer comme faite" />
              ) : (
                <span title="Relance planifiée" style={{ width: 20, flexShrink: 0, display: "inline-flex", justifyContent: "center", color: AMBER }}>
                  <CalendarLtr24Regular style={{ fontSize: 16 }} />
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0, cursor: it.link ? "pointer" : "default" }} onClick={() => it.link && router.push(it.link)}>
                <Body1 style={{ fontWeight: 600, fontSize: 13 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: KIND_COLOR[it.kind], marginRight: 6 }}>{KIND_LABEL[it.kind]}</span>
                  {it.title}
                </Body1>
                {it.sub && <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>{it.sub}</Caption1>}
              </div>
              <Caption1 style={{ color: b.key === "overdue" ? RED : "var(--colorNeutralForeground3)", flexShrink: 0, whiteSpace: "nowrap", fontSize: 11 }}>
                {fmt(it.date)}
              </Caption1>
              {it.itemType === "task" && (
                <Button appearance="subtle" size="small" icon={<Delete24Regular />} onClick={() => remove(it.raw)} title="Supprimer" />
              )}
            </div>
          ))}
        </Card>
      ))}

      {doneTasks.length > 0 && (
        <Card style={{ padding: "16px 18px 18px" }}>
          <Body1 style={{ fontWeight: 700, fontSize: 14, display: "block", marginBottom: 8, color: "var(--colorNeutralForeground3)" }}>Terminées</Body1>
          {doneTasks.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--colorNeutralStroke2)" }}>
              <Checkbox checked onChange={() => toggle(t)} aria-label="Rouvrir la tâche" />
              <Body1 style={{ flex: 1, fontSize: 13, color: "var(--colorNeutralForeground3)", textDecoration: "line-through" }}>{t.title}</Body1>
              <Button appearance="subtle" size="small" icon={<Delete24Regular />} onClick={() => remove(t)} title="Supprimer" />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
