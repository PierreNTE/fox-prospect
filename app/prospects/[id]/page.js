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
} from "@fluentui/react-components";
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
} from "@fluentui/react-icons";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const AMBER = "#F6A623";
const RED = "#C50F1F";

const NBA_COLORS = {
  prepare_rdv: GREEN, confirm_rdv: GREEN,
  relance_urgente: RED, relance: AMBER,
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
    <Card style={{ padding: "20px 20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Score décomposé</Body1>
        <ScoreBadge score={scores.global_score} />
      </div>
      <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 16 }}>
        Gate d'urgence ×{scores.breakdown.gate} — sans signal récent, le score est plafonné à 50.
        {scores.breakdown.top_signal && (
          <> Signal principal : <strong>{scores.breakdown.top_signal.type}</strong>{scores.breakdown.top_signal.date ? ` (${scores.breakdown.top_signal.date})` : ""}.</>
        )}
      </Caption1>
      {bars.map((b) => <ScoreBar key={b.label} {...b} />)}
    </Card>
  );
}

/* ── Page ── */

export default function ProspectPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [sourceStatuses, setSourceStatuses] = useState({});

  const load = async () => {
    const res = await fetch(`/api/prospects/${id}`);
    const d = await res.json();
    if (d.error) setError(d.error);
    else setData(d);
    return d;
  };

  useEffect(() => { load(); }, [id]);

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
  }, [data?.prospect?.id, data?.research?.id, data?.drafts?.id, data?.prospect?.status, data?.prospect?.email]);

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

  const { prospect, research, drafts } = data;

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

      {/* ── Notes ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <Body1 style={{ fontWeight: 700, fontSize: 15, display: "block", marginBottom: 12 }}>Notes</Body1>
        <NotesEditor prospect={prospect} />
      </Card>
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
