"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { computeScores } from "@/lib/scoring";
import { computeNba } from "@/lib/nba";
import {
  Card,
  Button,
  Input,
  Textarea,
  Title2,
  Body1,
  Caption1,
  Badge,
  Spinner,
  Select,
  Switch,
} from "@fluentui/react-components";
import {
  STATUS_ORDER, STATUS_LABELS, statusLabel,
  dataQualityLevel, DATA_QUALITY_LABELS,
} from "@/lib/constants";
import {
  Search24Regular,
  Mail24Regular,
  DocumentBulletList24Regular,
  Phone24Regular,
  LinkSquare24Regular,
  Flash24Regular,
  Copy24Regular,
  ArrowClockwise24Regular,
  Sparkle24Regular,
  ArrowLeft24Regular,
  Building24Regular,
  Chat24Regular,
  History24Regular,
  Add24Regular,
  CalendarLtr24Regular,
} from "@fluentui/react-icons";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const AMBER = "#F6A623";
const RED = "#C50F1F";

const NBA_COLORS = {
  prepare_rdv: GREEN, avancer: GREEN, fideliser: GREEN, appeler: GREEN,
  relance_urgente: RED, relance: AMBER, relance_prevue: RED,
  generer: BRAND, enrichir: "#8e44ad",
  envoyer: BRAND, rechercher: BRAND,
  opt_out: "var(--colorNeutralForeground3)", archive: "var(--colorNeutralForeground3)",
};

function ScoreBadge({ score, big }) {
  if (score == null) return <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>—</Caption1>;
  const color = score >= 70 ? GREEN : score >= 40 ? AMBER : RED;
  return (
    <span style={{ fontWeight: 800, fontSize: big ? 36 : 15, color, lineHeight: 1 }}>
      {score}{big ? "" : "/100"}
    </span>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      appearance="subtle"
      size="small"
      icon={done ? undefined : <Copy24Regular />}
      onClick={async () => {
        await navigator.clipboard.writeText(text || "");
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? "Copié ✓" : "Copier"}
    </Button>
  );
}

function NbaBanner({ nba }) {
  if (!nba || nba.priority === 0) return null;
  const color = NBA_COLORS[nba.action] || BRAND;
  return (
    <Card style={{
      borderLeft: `3px solid ${color}`,
      padding: "12px 16px",
      background: `color-mix(in srgb, ${color} 6%, var(--colorNeutralBackground1))`,
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <Caption1 style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--colorNeutralForeground3)", whiteSpace: "nowrap" }}>
        Prochaine action
      </Caption1>
      <span style={{ fontWeight: 700, fontSize: 12, padding: "2px 10px", borderRadius: 12, background: color, color: "#fff", whiteSpace: "nowrap" }}>
        {nba.label}
      </span>
      <Caption1 style={{ color: "var(--colorNeutralForeground2)", flex: 1 }}>{nba.reason}</Caption1>
      <span style={{ fontWeight: 800, fontSize: 17, color, flexShrink: 0 }}>{nba.priority}</span>
    </Card>
  );
}

// Bandeau coordonnées — l'information la plus visible (priorité : tél > email > LinkedIn).
// Tél et email actionnables (clic-pour-appeler / écrire). Un prospect sans tél NI email
// est signalé « non exploitable ».
function ContactBar({ prospect }) {
  const phone = (prospect.phone || "").trim();
  const email = (prospect.email || "").trim();
  const linkedin = (prospect.linkedin_url || "").trim();
  const exploitable = phone || email;
  return (
    <Card style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {phone && (
        <a href={`tel:${phone.replace(/\s/g, "")}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none",
            background: GREEN, color: "#fff", fontWeight: 700, fontSize: 15, padding: "8px 14px", borderRadius: 8 }}>
          <Phone24Regular style={{ fontSize: 18 }} /> {phone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none",
            color: BRAND, fontWeight: 600, fontSize: 14, padding: "8px 12px", border: `1px solid ${BRAND}`, borderRadius: 8 }}>
          <Mail24Regular style={{ fontSize: 16 }} /> {email}
        </a>
      )}
      {linkedin && (
        <a href={linkedin} target="_blank" rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none",
            color: "#0077b5", fontSize: 13, padding: "8px 10px" }}>
          <LinkSquare24Regular style={{ fontSize: 16 }} /> LinkedIn ↗
        </a>
      )}
      {!exploitable && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: RED, fontWeight: 700, fontSize: 13 }}>
          ⚠ Non exploitable — ni téléphone ni email
        </span>
      )}
    </Card>
  );
}

// Barre de pilotage : statut commercial (6 niveaux), qualité de la donnée
// (dérivée), et drapeau RGPD « ne pas contacter » (séparé du statut).
function StatusBar({ prospect, onPatch }) {
  const quality = dataQualityLevel(prospect);
  const qColor = quality === "verifie" ? GREEN : quality === "a_confirmer" ? AMBER : RED;
  return (
    <Card style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Caption1 style={{ fontWeight: 600, color: "var(--colorNeutralForeground3)" }}>Statut</Caption1>
        <Select value={prospect.status} onChange={(_, d) => onPatch({ status: d.value })} style={{ width: "auto" }}>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Caption1 style={{ fontWeight: 600, color: "var(--colorNeutralForeground3)" }}>Donnée</Caption1>
        <span title="Qualité dérivée de la confiance email + présence d'un téléphone"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
            color: qColor, border: `1px solid ${qColor}`, borderRadius: 12, padding: "2px 10px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: qColor }} />
          {DATA_QUALITY_LABELS[quality]}
        </span>
      </div>
      <div style={{ marginLeft: "auto" }}>
        <Switch
          checked={!!prospect.do_not_contact}
          onChange={(_, d) => onPatch({ do_not_contact: d.checked })}
          label="Ne pas contacter"
        />
      </div>
    </Card>
  );
}

// ── Suivi commercial : timeline d'interactions + saisie rapide (P3 #2) ───────
const CHANNEL_META = {
  appel:    { label: "Appel",    Icon: Phone24Regular,      color: GREEN },
  email:    { label: "E-mail",   Icon: Mail24Regular,       color: BRAND },
  linkedin: { label: "LinkedIn", Icon: LinkSquare24Regular, color: "#0077b5" },
  autre:    { label: "Autre",    Icon: Chat24Regular,       color: "var(--colorNeutralForeground3)" },
};

function fmtDate(s) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(s); }
}

// Description d'un événement système (non-interaction) pour la timeline.
function describeEvent(ev) {
  switch (ev.kind) {
    case "status_change":
      return { label: "Changement de statut", detail: `${statusLabel(ev.from_status)} → ${statusLabel(ev.to_status)}`, color: "var(--colorNeutralForeground3)", Icon: ArrowClockwise24Regular };
    case "research_done":
      return { label: "Recherche IA", detail: "Qualification effectuée", color: BRAND, Icon: Search24Regular };
    case "draft_generated":
      return { label: "Brouillons générés", detail: "Email · LinkedIn · points d'appel", color: "#8e44ad", Icon: Sparkle24Regular };
    case "enrich_done":
      return { label: "Enrichissement", detail: ev.note || "Coordonnées enrichies", color: "#8e44ad", Icon: Search24Regular };
    case "opt_out":
      return { label: "Ne pas contacter", detail: ev.note || "Opposition enregistrée", color: RED, Icon: Flash24Regular };
    case "auto_action":
      return { label: "Action automatique", detail: ev.note || "", color: "var(--colorNeutralForeground3)", Icon: Flash24Regular };
    default:
      return { label: ev.kind, detail: ev.note || "", color: "var(--colorNeutralForeground3)", Icon: Flash24Regular };
  }
}

function SuiviCommercial({ prospect, events, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [channel, setChannel] = useState("appel");
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const followUpAt = prospect.follow_up_at;
  const overdue = followUpAt && followUpAt < today;
  const dueToday = followUpAt && followUpAt === today;

  const submit = async () => {
    setErr("");
    if (!note.trim() && !nextAction.trim()) { setErr("Renseigne au moins un compte-rendu ou une prochaine action."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/prospects/${prospect.id}/interactions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, occurred_at: occurredOn || undefined, note, next_action: nextAction, follow_up_at: followUp || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) { setErr(d.error || `Erreur ${res.status}.`); return; }
      setNote(""); setNextAction(""); setFollowUp(""); setChannel("appel"); setOccurredOn(today);
      onSaved && onSaved();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card style={{ padding: "20px 20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <History24Regular style={{ color: BRAND }} />
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Suivi commercial</Body1>
      </div>

      {followUpAt && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8,
          color: overdue ? RED : dueToday ? "#E8730C" : "var(--colorNeutralForeground2)" }}>
          <CalendarLtr24Regular style={{ fontSize: 16 }} />
          <Caption1 style={{ fontWeight: 600 }}>
            Relance {overdue ? "en retard" : dueToday ? "aujourd'hui" : "prévue"} le {fmtDate(followUpAt)}
            {prospect.next_action ? ` — ${prospect.next_action}` : ""}
          </Caption1>
        </div>
      )}

      {/* Saisie rapide */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Canal</Caption1>
          <Select value={channel} onChange={(_, d) => setChannel(d.value)}>
            <option value="appel">Appel</option>
            <option value="email">E-mail</option>
            <option value="linkedin">LinkedIn</option>
            <option value="autre">Autre</option>
          </Select>
        </div>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Date du contact</Caption1>
          <Input type="date" value={occurredOn} onChange={(_, d) => setOccurredOn(d.value)} />
        </div>
      </div>
      <Caption1 style={{ display: "block", margin: "10px 0 4px", fontWeight: 600 }}>Compte-rendu / retour du prospect</Caption1>
      <Textarea value={note} onChange={(_, d) => setNote(d.value)} rows={2}
        placeholder="Points abordés, retour, objections…" style={{ width: "100%" }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Prochaine action</Caption1>
          <Input value={nextAction} onChange={(_, d) => setNextAction(d.value)} placeholder="Ex. envoyer la doc" />
        </div>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Date de relance</Caption1>
          <Input type="date" value={followUp} onChange={(_, d) => setFollowUp(d.value)} />
        </div>
      </div>
      {err && <Caption1 style={{ color: RED, display: "block", marginTop: 8 }}>{err}</Caption1>}
      <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Add24Regular />} disabled={busy}
        onClick={submit} style={{ marginTop: 12 }}>
        {busy ? "Enregistrement…" : "Enregistrer l'échange"}
      </Button>

      {/* Timeline */}
      <div style={{ marginTop: 22 }}>
        <Caption1 style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--colorNeutralForeground3)" }}>
          Historique ({events.length})
        </Caption1>
        {events.length === 0 ? (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 8 }}>
            Aucune interaction pour l'instant. Enregistre ton premier échange ci-dessus.
          </Caption1>
        ) : (
          <div style={{ marginTop: 8 }}>
            {events.map((ev) => {
              const isInteraction = ev.kind === "interaction";
              const meta = isInteraction ? (CHANNEL_META[ev.channel] || CHANNEL_META.autre) : describeEvent(ev);
              const Icon = meta.Icon;
              return (
                <div key={ev.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--colorNeutralStroke2)" }}>
                  <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}>
                    <Icon style={{ fontSize: 16, color: meta.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Body1 style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</Body1>
                    {isInteraction ? (
                      <>
                        {ev.note && <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 1 }}>{ev.note}</Caption1>}
                        {ev.next_action && (
                          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
                            → {ev.next_action}{ev.follow_up_at ? ` · relance ${fmtDate(ev.follow_up_at)}` : ""}
                          </Caption1>
                        )}
                      </>
                    ) : (
                      meta.detail && <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>{meta.detail}</Caption1>
                    )}
                  </div>
                  <Caption1 style={{ color: "var(--colorNeutralForeground3)", flexShrink: 0, whiteSpace: "nowrap", fontSize: 11 }}>
                    {fmtDate(ev.occurred_at)}
                  </Caption1>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Section dépliable (P4 #8 : garder l'essentiel visible, l'enrichi repliable) ─
function Collapsible({ title, icon, defaultOpen = false, right, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = icon;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "16px 20px",
          background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}>
        {Icon && <Icon style={{ color: BRAND, fontSize: 18, flexShrink: 0 }} />}
        <Body1 style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{title}</Body1>
        {right}
        <span style={{ color: "var(--colorNeutralForeground3)", display: "inline-block",
          transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      </button>
      {open && <div style={{ padding: "0 20px 22px" }}>{children}</div>}
    </Card>
  );
}

// ── Brief commercial à la demande (P4 #5) ───────────────────────────────────
const DISC_LABEL = { D: "Dominant", I: "Influent", S: "Stable", C: "Consciencieux" };
const CHANGE_LABEL = { poste: "Poste", equipe: "Équipe", organisation: "Organisation", recrutement: "Recrutement", projet: "Projet", actualite: "Actualité" };
const CANAL_LABEL = { appel: "Appel", email: "E-mail", linkedin: "LinkedIn" };

function discProfileLabel(p) {
  if (!p) return "Indéterminé";
  return p.split("").map((l) => DISC_LABEL[l] || l).join(" / ");
}

function PeopleList({ people, kind }) {
  if (!people?.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {people.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: i > 0 ? "1px solid var(--colorNeutralStroke2)" : "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Body1 style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</Body1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{p.role}</Caption1>
            {p.pourquoi && <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block" }}>{p.pourquoi}</Caption1>}
          </div>
          {kind === "relation" && p.relation && (
            <span style={{ fontSize: 10, fontWeight: 700, alignSelf: "flex-start", color: "var(--colorNeutralForeground3)", border: "1px solid var(--colorNeutralStroke2)", borderRadius: 4, padding: "1px 6px" }}>
              {p.relation}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BriefCommercial({ brief, busy, onGenerate }) {
  const disc = brief?.disc;
  const ent = brief?.entourage || {};
  const entCount = (ent.equipe?.length || 0) + (ent.decideurs?.length || 0) + (ent.contacts_secondaires?.length || 0);
  const confColor = disc?.confiance === "haute" ? GREEN : disc?.confiance === "moyenne" ? AMBER : "var(--colorNeutralForeground3)";

  return (
    <Card style={{ padding: "20px 20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkle24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Brief commercial</Body1>
        </div>
        <Button appearance={brief ? "outline" : "primary"} size="small"
          icon={busy ? <Spinner size="tiny" /> : <Sparkle24Regular />} disabled={busy} onClick={onGenerate}>
          {busy ? "Analyse en cours…" : brief ? "Régénérer" : "Préparer l'approche (IA)"}
        </Button>
      </div>

      {!brief && !busy && (
        <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 10, lineHeight: 1.6 }}>
          Analyse approfondie <strong>à la demande</strong> pour préparer un premier contact : changements récents
          exploitables, accroches personnalisées, profil DISC (si assez de signal) et entourage décisionnel.
          Consomme du budget IA — déclenchée uniquement quand tu le décides.
        </Caption1>
      )}

      {busy && (
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 10 }}>
          Recherche web + analyse, 20-60 secondes…
        </Caption1>
      )}

      {brief && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          {brief.synthese_approche && (
            <div style={{ padding: "12px 14px", borderRadius: 8, background: `color-mix(in srgb, ${BRAND} 6%, var(--colorNeutralBackground1))`, borderLeft: `3px solid ${BRAND}` }}>
              <Body1 style={{ color: "var(--colorNeutralForeground1)", lineHeight: 1.6 }}>{brief.synthese_approche}</Body1>
            </div>
          )}

          {/* Changements récents */}
          {(brief.changements_recents || []).length > 0 && (
            <div>
              <Body1 style={{ fontWeight: 700, fontSize: 14, display: "block", marginBottom: 8 }}>Changements récents</Body1>
              {brief.changements_recents.map((c, i) => (
                <div key={i} style={{ padding: "10px 12px", borderRadius: 6, marginBottom: 6, background: "var(--colorNeutralBackground3)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#E8730C", border: "1px solid #E8730C", borderRadius: 4, padding: "0 6px" }}>
                      {CHANGE_LABEL[c.type] || c.type}
                    </span>
                    <Body1 style={{ fontWeight: 600, fontSize: 13 }}>{c.detail}</Body1>
                  </div>
                  {c.accroche && <Caption1 style={{ color: BRAND, display: "block", marginTop: 6, fontStyle: "italic" }}>« {c.accroche} »</Caption1>}
                  <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>
                    {c.date}{c.source && <> · {c.source}</>}
                  </Caption1>
                </div>
              ))}
            </div>
          )}

          {/* Accroches personnalisées */}
          {(brief.accroches || []).length > 0 && (
            <div>
              <Body1 style={{ fontWeight: 700, fontSize: 14, display: "block", marginBottom: 8 }}>Accroches personnalisées</Body1>
              {brief.accroches.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderTop: i > 0 ? "1px solid var(--colorNeutralStroke2)" : "none" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: "var(--colorNeutralForeground3)", border: "1px solid var(--colorNeutralStroke2)", borderRadius: 4, padding: "1px 6px", height: "fit-content" }}>
                    {CANAL_LABEL[a.canal] || a.canal}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {a.angle && <Caption1 style={{ fontWeight: 700, display: "block" }}>{a.angle}</Caption1>}
                    <Caption1 style={{ color: BRAND, fontStyle: "italic" }}>« {a.phrase} »</Caption1>
                  </div>
                  <CopyButton text={a.phrase} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Détails enrichis repliables */}
      {brief && disc && (
        <div style={{ marginTop: 14 }}>
          <Collapsible title="Profil DISC" icon={Flash24Regular}
            right={<span style={{ fontSize: 11, fontWeight: 700, color: confColor }}>{discProfileLabel(disc.profil)} · confiance {disc.confiance}</span>}>
            {disc.confiance === "basse" && (
              <Caption1 style={{ color: AMBER, display: "block", marginBottom: 8 }}>
                Signal public limité — lecture indicative, à confirmer au contact.
              </Caption1>
            )}
            {disc.style_communication && <Caption1 style={{ color: "var(--colorNeutralForeground1)", display: "block", marginBottom: 8 }}>{disc.style_communication}</Caption1>}
            {disc.traits?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {disc.traits.map((t, i) => <span key={i} style={{ fontSize: 11, background: "var(--colorNeutralBackground3)", borderRadius: 12, padding: "2px 10px" }}>{t}</span>)}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {disc.a_faire?.length > 0 && (
                <div>
                  <Caption1 style={{ fontWeight: 700, color: GREEN, display: "block", marginBottom: 4 }}>À faire</Caption1>
                  {disc.a_faire.map((x, i) => <Caption1 key={i} style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>· {x}</Caption1>)}
                </div>
              )}
              {disc.a_eviter?.length > 0 && (
                <div>
                  <Caption1 style={{ fontWeight: 700, color: RED, display: "block", marginBottom: 4 }}>À éviter</Caption1>
                  {disc.a_eviter.map((x, i) => <Caption1 key={i} style={{ display: "block", color: "var(--colorNeutralForeground2)" }}>· {x}</Caption1>)}
                </div>
              )}
            </div>
            {disc.base && <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 10, fontStyle: "italic" }}>Base : {disc.base}</Caption1>}
          </Collapsible>
        </div>
      )}

      {brief && entCount > 0 && (
        <div style={{ marginTop: 10 }}>
          <Collapsible title="Entourage décisionnel" icon={Building24Regular}
            right={<span style={{ fontSize: 11, color: "var(--colorNeutralForeground3)" }}>{entCount} personne(s)</span>}>
            {ent.equipe?.length > 0 && <><Caption1 style={{ fontWeight: 700, display: "block" }}>Équipe</Caption1><PeopleList people={ent.equipe} kind="relation" /></>}
            {ent.decideurs?.length > 0 && <><Caption1 style={{ fontWeight: 700, display: "block", marginTop: 12 }}>Décideurs influents</Caption1><PeopleList people={ent.decideurs} /></>}
            {ent.contacts_secondaires?.length > 0 && <><Caption1 style={{ fontWeight: 700, display: "block", marginTop: 12 }}>Contacts secondaires</Caption1><PeopleList people={ent.contacts_secondaires} /></>}
          </Collapsible>
        </div>
      )}
    </Card>
  );
}

function ScoreBar({ label, score, note }) {
  const color = score >= 70 ? BRAND : score >= 40 ? AMBER : RED;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <Body1 style={{ fontSize: 13, fontWeight: 600 }}>{label}</Body1>
        <span style={{ fontWeight: 700, fontSize: 14, color }}>{score}/100</span>
      </div>
      <div style={{ background: "var(--colorNeutralBackground3)", borderRadius: 4, height: 6, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, transition: "width 0.5s ease", borderRadius: 4 }} />
      </div>
      {note && <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>{note}</Caption1>}
    </div>
  );
}

function ScoreBreakdown({ scores, prospect }) {
  const bars = [
    { label: "Urgence des signaux", score: scores.urgency_score,
      note: `${scores.breakdown.signals_count} signal(s) · décroissance temporelle par type` },
    { label: "Potentiel business", score: scores.business_score,
      note: scores.breakdown.firmographics_source === "sirene" ? "Données SIRENE vérifiées" : "Estimation — enrichir le SIREN pour affiner" },
    { label: "Accessibilité du contact", score: scores.accessibility_score,
      note: [prospect.email ? `email (${prospect.email_confidence || "?"})` : "email manquant", prospect.phone ? "téléphone" : null, prospect.linkedin_url ? "LinkedIn" : null].filter(Boolean).join(" · ") },
  ];
  return (
    <Collapsible title="Score décomposé" right={<ScoreBadge score={scores.global_score} />}>
      <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 16 }}>
        Gate d'urgence ×{scores.breakdown.gate} — sans signal récent, le score est plafonné à 50.
        {scores.breakdown.top_signal && (
          <> Signal principal : <strong>{scores.breakdown.top_signal.type}</strong>{scores.breakdown.top_signal.date ? ` (${scores.breakdown.top_signal.date})` : ""}.</>
        )}
      </Caption1>
      {bars.map((b) => <ScoreBar key={b.label} {...b} />)}
    </Collapsible>
  );
}

/* ── Page ── */

// Cache mémoire par prospect : réafficher une fiche déjà ouverte (ou recharger
// après une action) est instantané, puis se rafraîchit en fond. Vidé au reload.
const detailCache = new Map();

export default function ProspectPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(() => detailCache.get(id) || null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [sourceStatuses, setSourceStatuses] = useState({});

  const load = async () => {
    const res = await fetch(`/api/prospects/${id}`, { cache: "no-store" });
    const d = await res.json();
    if (d.error) setError(d.error);
    else { detailCache.set(id, d); setData(d); }
    return d;
  };

  // Au changement d'id : on affiche d'abord le cache (instantané) puis on rafraîchit.
  useEffect(() => { setData(detailCache.get(id) || null); load(); }, [id]);

  useEffect(() => {
    if (!data?.research?.sources?.length) return;
    const urls = data.research.sources.filter((u) => u?.startsWith("http"));
    if (!urls.length) return;
    fetch("/api/verify-sources", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls }),
    }).then((r) => r.json()).then((d) => setSourceStatuses(d.results || {})).catch(() => {});
  }, [data?.research?.id]);

  const scores = useMemo(() => {
    if (!data?.research?.signals) return null;
    try { return computeScores({ prospect: data.prospect, signals: data.research.signals, firmographics: {} }); }
    catch { return null; }
  }, [data?.research?.id, data?.prospect?.id]);

  const nba = useMemo(() => {
    if (!data) return null;
    return computeNba({ prospect: data.prospect, research: data.research, drafts: data.drafts });
  }, [data?.prospect?.id, data?.research?.id, data?.drafts?.id, data?.prospect?.status, data?.prospect?.email, data?.prospect?.do_not_contact]);

  // Mise à jour statut / drapeau « ne pas contacter » → PATCH puis recharge.
  const patchProspect = async (fields) => {
    setError("");
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
      await load();
    } catch (e) { setError(e.message); }
  };

  const run = async (endpoint, label, extraBody = {}) => {
    setBusy(label); setError("");
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId: id, ...extraBody }),
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const generate = () => run("generate", "generate", selectedSignal ? { triggerSignal: selectedSignal } : {});
  const toggleSignal = (s) => setSelectedSignal((prev) => prev?.detail === s.detail ? null : s);

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
        {error ? <Body1 style={{ color: RED }}>{error}</Body1>
          : <><Spinner size="small" /><Body1 style={{ color: "var(--colorNeutralForeground2)" }}>Chargement…</Body1></>}
      </div>
    );
  }

  const { prospect, research, drafts, events, brief } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div>
        <button
          onClick={() => router.push("/")}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "var(--colorNeutralForeground3)", fontSize: 13, padding: "0 0 10px", marginLeft: -4 }}
        >
          <ArrowLeft24Regular style={{ fontSize: 16 }} /> La piste
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <Title2>{prospect.first_name} {prospect.last_name}</Title2>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              {prospect.role && <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{prospect.role}</Caption1>}
              {prospect.company && <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>· {prospect.company}</Caption1>}
              {prospect.linkedin_url && (
                <a href={prospect.linkedin_url} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 4, color: BRAND, textDecoration: "none", fontSize: 13 }}>
                  <LinkSquare24Regular style={{ fontSize: 15 }} />LinkedIn ↗
                </a>
              )}
              {prospect.company_website && (
                <a href={prospect.company_website} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 4, color: BRAND, textDecoration: "none", fontSize: 13 }}>
                  Site ↗
                </a>
              )}
              {prospect.account_id && (
                <a href={`/accounts/${prospect.account_id}`}
                  style={{ display: "flex", alignItems: "center", gap: 4, color: BRAND, textDecoration: "none", fontSize: 13 }}>
                  <Building24Regular style={{ fontSize: 15 }} />Fiche compte ↗
                </a>
              )}
            </div>
          </div>
          {prospect.fit_score != null && <ScoreBadge score={prospect.fit_score} big />}
        </div>
      </div>

      {/* ── Coordonnées (info la plus visible) ── */}
      <ContactBar prospect={prospect} />

      {/* ── Statut commercial + qualité donnée + opposition RGPD ── */}
      <StatusBar prospect={prospect} onPatch={patchProspect} />

      {/* ── Error ── */}
      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── NBA banner ── */}
      {nba && <NbaBanner nba={nba} />}

      {/* ── Action buttons ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button
          appearance="primary"
          icon={busy === "research" ? <Spinner size="tiny" /> : <Search24Regular />}
          disabled={!!busy}
          onClick={() => run("research", "research")}
        >
          {research ? "Relancer la recherche" : "Lancer la recherche"}
        </Button>
        <Button
          appearance="outline"
          icon={busy === "generate" ? <Spinner size="tiny" /> : <Sparkle24Regular />}
          disabled={!!busy || !research}
          onClick={generate}
        >
          {selectedSignal ? `Générer triggered — ${selectedSignal.type}` : drafts ? "Régénérer les brouillons" : "Générer les brouillons"}
        </Button>
        {selectedSignal && (
          <Button appearance="subtle" size="small" onClick={() => setSelectedSignal(null)}>
            × Annuler le signal trigger
          </Button>
        )}
        {busy === "research" && (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Recherche web en cours, 20-40 secondes…</Caption1>
        )}
      </div>

      {/* ── Suivi commercial : historique des interactions + saisie rapide ── */}
      <SuiviCommercial prospect={prospect} events={events || []} onSaved={load} />

      {/* ── Brief commercial à la demande (DISC, triggers, accroches, entourage) ── */}
      <BriefCommercial brief={brief} busy={busy === "brief"} onGenerate={() => run("brief", "brief", brief ? { force: true } : {})} />

      {/* ── Empty state ── */}
      {!research && !busy && (
        <Card style={{ padding: "32px 24px", textAlign: "center" }}>
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>
            Pas encore de recherche. Lance-la : signaux d'achat, actualité, score de fit et angles d'accroche.
          </Body1>
        </Card>
      )}

      {/* ── Research card ── */}
      {research && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Fiche de recherche</Body1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              {new Date(research.created_at).toLocaleString("fr-FR")}
            </Caption1>
          </div>
          <Body1 style={{ color: "var(--colorNeutralForeground2)", lineHeight: 1.6, display: "block", marginBottom: 8 }}>
            {research.summary}
          </Body1>
          {research.fit_reason && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>
              <strong>Pourquoi ce score :</strong> {research.fit_reason}
            </Caption1>
          )}

          {/* Signals */}
          {(research.signals || []).length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, marginBottom: 8 }}>
                <Body1 style={{ fontWeight: 700, fontSize: 14 }}>Signaux détectés</Body1>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Clique pour déclencher</Caption1>
              </div>
              {research.signals.map((s, i) => {
                const isSelected = selectedSignal?.detail === s.detail;
                return (
                  <div
                    key={i}
                    onClick={() => toggleSignal(s)}
                    style={{
                      padding: "10px 12px", borderRadius: 6, marginBottom: 6, cursor: "pointer",
                      border: `1px solid ${isSelected ? BRAND : "var(--colorNeutralStroke2)"}`,
                      background: isSelected ? `color-mix(in srgb, ${BRAND} 6%, var(--colorNeutralBackground1))` : "transparent",
                      transition: "border-color .12s, background .12s",
                    }}
                  >
                    <Body1 style={{ fontWeight: 600 }}>
                      {s.type}
                      {isSelected && <span style={{ color: BRAND, marginLeft: 8, fontSize: 12 }}>⚡ trigger</span>}
                      <span style={{ fontWeight: 400 }}> — {s.detail}</span>
                    </Body1>
                    <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
                      {s.date}{s.source && <> · {s.source}</>}
                    </Caption1>
                  </div>
                );
              })}
            </>
          )}

          {/* Hooks */}
          {(research.hooks || []).length > 0 && (
            <>
              <Body1 style={{ fontWeight: 700, fontSize: 14, display: "block", marginTop: 20, marginBottom: 10 }}>
                Angles d'accroche
              </Body1>
              {research.hooks.map((h, i) => (
                <div key={i} style={{ padding: "10px 12px", borderRadius: 6, marginBottom: 8, background: "var(--colorNeutralBackground3)" }}>
                  <Body1 style={{ fontWeight: 600 }}>{i + 1}. {h.angle}</Body1>
                  <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 2 }}>{h.pourquoi}</Caption1>
                  {h.phrase && (
                    <Caption1 style={{ color: BRAND, display: "block", marginTop: 6, fontStyle: "italic" }}>
                      « {h.phrase} »
                    </Caption1>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Sources */}
          {(research.sources || []).length > 0 && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 12 }}>
              Sources :{" "}
              {research.sources.map((u, i) => {
                const status = sourceStatuses[u];
                return (
                  <span key={i} style={{ marginRight: 6 }}>
                    <a href={u} target="_blank" rel="noreferrer" style={{ color: BRAND }}>[{i + 1}]</a>
                    {status !== undefined && (
                      <span title={status?.ok ? "Source accessible" : "Source inaccessible"}
                        style={{ color: status?.ok ? GREEN : "var(--colorNeutralForeground3)", fontSize: 11 }}>
                        {status?.ok ? " ✓" : " ⚠"}
                      </span>
                    )}
                    {" "}
                  </span>
                );
              })}
            </Caption1>
          )}
        </Card>
      )}

      {/* ── Score breakdown ── */}
      {research && scores && <ScoreBreakdown scores={scores} prospect={prospect} />}

      {/* ── Drafts ── */}
      {drafts && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <Body1 style={{ fontWeight: 700, fontSize: 15, display: "block", marginBottom: 4 }}>Brouillons</Body1>
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 16 }}>
            À relire et ajuster avant envoi manuel.
          </Caption1>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Mail24Regular style={{ color: BRAND, fontSize: 16 }} />
              <Body1 style={{ fontWeight: 600, fontSize: 13 }}>Email · {drafts.email_subject}</Body1>
            </div>
            <CopyButton text={`Objet : ${drafts.email_subject}\n\n${drafts.email_body}`} />
          </div>
          <div style={{ padding: "12px 14px", background: "var(--colorNeutralBackground3)", borderRadius: 6, marginBottom: 16, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--colorNeutralForeground2)" }}>
            {drafts.email_body}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <LinkSquare24Regular style={{ color: "#0077b5", fontSize: 16 }} />
              <Body1 style={{ fontWeight: 600, fontSize: 13 }}>LinkedIn ({(drafts.linkedin_message || "").length} car.)</Body1>
            </div>
            <CopyButton text={drafts.linkedin_message} />
          </div>
          <div style={{ padding: "12px 14px", background: "var(--colorNeutralBackground3)", borderRadius: 6, marginBottom: 16, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--colorNeutralForeground2)" }}>
            {drafts.linkedin_message}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Phone24Regular style={{ color: GREEN, fontSize: 16 }} />
              <Body1 style={{ fontWeight: 600, fontSize: 13 }}>Points d'appel</Body1>
            </div>
            <CopyButton text={(drafts.call_points || []).join("\n")} />
          </div>
          <div style={{ padding: "12px 14px", background: "var(--colorNeutralBackground3)", borderRadius: 6, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--colorNeutralForeground2)" }}>
            {(drafts.call_points || []).map((c, i) => `${i + 1}. ${c}`).join("\n")}
          </div>
        </Card>
      )}

      {/* ── Coordonnées ── */}
      <ContactCoords prospect={prospect} onSaved={load} />

      {/* ── Notes (repliable) ── */}
      <Collapsible title="Notes" icon={DocumentBulletList24Regular} defaultOpen={!!(prospect.notes || "").trim()}>
        <NotesEditor prospect={prospect} />
      </Collapsible>
    </div>
  );
}

function ContactCoords({ prospect, onSaved }) {
  const [email, setEmail] = useState(prospect.email || "");
  const [phone, setPhone] = useState(prospect.phone || "");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrichment, setEnrichment] = useState(null);

  const save = async (fields) => {
    setErr("");
    const res = await fetch(`/api/prospects/${prospect.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) { setErr(d.error || `Erreur ${res.status}.`); return false; }
    setSaved(true); setTimeout(() => setSaved(false), 1600);
    onSaved && onSaved();
    return true;
  };

  const enrich = async () => {
    setBusy(true); setErr(""); setEnrichment(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId: prospect.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) setErr(d.error || `Erreur ${res.status}.`);
      else {
        setEnrichment(d.enrichment);
        if (d.prospect?.email) setEmail(d.prospect.email);
        if (d.prospect?.phone) setPhone(d.prospect.phone);
        onSaved && onSaved();
      }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const suggestionDiffers = enrichment?.email && prospect.email &&
    enrichment.email.toLowerCase() !== prospect.email.toLowerCase();

  return (
    <Card style={{ padding: "20px 20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Coordonnées</Body1>
        <Button
          appearance="outline"
          size="small"
          icon={busy ? <Spinner size="tiny" /> : <Search24Regular />}
          disabled={busy}
          onClick={enrich}
        >
          {busy ? "Recherche en cours…" : "Enrichir automatiquement"}
        </Button>
      </div>

      {busy && (
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 10 }}>
          Recherche web du pattern d'email et du standard, 20-60 secondes…
        </Caption1>
      )}

      {err && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "10px 12px", marginBottom: 12 }}>
          <Caption1 style={{ color: RED }}>{err}</Caption1>
        </Card>
      )}

      {enrichment && (
        <Card style={{
          borderLeft: `3px solid ${enrichment.email || enrichment.phone ? "#107C10" : RED}`,
          padding: "10px 12px", marginBottom: 14,
        }}>
          <Caption1>
            {enrichment.email ? (
              <>Email proposé : <strong>{enrichment.email}</strong> (confiance {enrichment.email_confidence || "?"}){enrichment.email_source && <> — {enrichment.email_source}</>}</>
            ) : "Aucun email trouvé avec certitude."}
            {enrichment.phone && <><br />Standard : <strong>{enrichment.phone}</strong></>}
          </Caption1>
          {suggestionDiffers && (
            <Button appearance="subtle" size="small" style={{ marginTop: 8 }}
              onClick={() => { setEmail(enrichment.email); save({ email: enrichment.email }); }}>
              Remplacer par l'email proposé
            </Button>
          )}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Email pro</Caption1>
          <Input
            type="email"
            value={email}
            onChange={(_, d) => setEmail(d.value)}
            placeholder="prenom.nom@entreprise.fr"
            contentBefore={<Mail24Regular />}
          />
          {prospect.email_confidence && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>
              Confiance : {prospect.email_confidence}{prospect.email_source ? ` — ${prospect.email_source}` : ""}
            </Caption1>
          )}
        </div>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Téléphone</Caption1>
          <Input
            type="tel"
            value={phone}
            onChange={(_, d) => setPhone(d.value)}
            placeholder="+33 1 23 45 67 89"
            contentBefore={<Phone24Regular />}
          />
        </div>
      </div>
      <Button
        appearance="outline"
        onClick={() => save({ email: email.trim() || null, phone: phone.trim() || "" })}
      >
        {saved ? "Enregistré ✓" : "Enregistrer les coordonnées"}
      </Button>
    </Card>
  );
}

function NotesEditor({ prospect }) {
  const [notes, setNotes] = useState(prospect.notes || "");
  const [saved, setSaved] = useState(false);
  return (
    <>
      <Textarea
        value={notes}
        onChange={(_, d) => setNotes(d.value)}
        placeholder="Compte-rendu d'appel, contexte, prochaine étape…"
        rows={4}
        style={{ width: "100%", marginBottom: 10 }}
      />
      <Button
        appearance="outline"
        onClick={async () => {
          await fetch(`/api/prospects/${prospect.id}`, {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({ notes }),
          });
          setSaved(true); setTimeout(() => setSaved(false), 1600);
        }}
      >
        {saved ? "Enregistré ✓" : "Enregistrer les notes"}
      </Button>
    </>
  );
}
