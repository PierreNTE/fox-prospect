"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { computeScores } from "@/lib/scoring";
import { computeNba } from "@/lib/nba";

function ScoreBadge({ score }) {
  if (score == null) return <span className="score score-none">—</span>;
  const cls = score >= 70 ? "score-high" : score >= 40 ? "score-mid" : "score-low";
  return <span className={`score ${cls}`}>{score}/100</span>;
}

function CopyButton({ text, label = "Copier" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text || "");
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? "Copié ✓" : label}
    </button>
  );
}

function SourceBadge({ url, verified }) {
  if (verified === undefined) return null;
  return verified
    ? <span title="Source accessible (HTTP 200)" style={{ color: "var(--green, #27ae60)", fontSize: 11 }}>✓</span>
    : <span title="Source inaccessible ou introuvable" style={{ color: "var(--text-3)", fontSize: 11 }}>⚠</span>;
}

const NBA_COLORS = {
  prepare_rdv: "#27ae60", confirm_rdv: "#27ae60",
  relance_urgente: "#c0392b", relance: "#e67e22",
  generer: "var(--accent)", enrichir: "#8e44ad",
  envoyer: "var(--accent)", rechercher: "var(--accent)",
  opt_out: "var(--text-3)", archive: "var(--text-3)",
};

function NbaBanner({ nba }) {
  if (!nba || nba.priority === 0) return null;
  const color = NBA_COLORS[nba.action] || "var(--accent)";
  return (
    <div
      style={{
        background: `color-mix(in srgb, ${color} 8%, var(--bg, #fff))`,
        borderLeft: `3px solid ${color}`,
        borderRadius: "0 6px 6px 0",
        padding: "10px 16px",
        marginBottom: 4,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
        Prochaine action
      </span>
      <span
        style={{
          fontWeight: 700,
          fontSize: 12,
          padding: "2px 10px",
          borderRadius: 12,
          background: color,
          color: "#fff",
          whiteSpace: "nowrap",
        }}
      >
        {nba.label}
      </span>
      <span className="sub small" style={{ flex: 1, margin: 0 }}>{nba.reason}</span>
      <span
        style={{
          fontWeight: 800,
          fontSize: 16,
          color,
          minWidth: 28,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {nba.priority}
      </span>
    </div>
  );
}

function ScoreBar({ label, score, note }) {
  const color = score >= 70 ? "var(--accent)" : score >= 40 ? "#e67e22" : "var(--text-3)";
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        className="row spread"
        style={{ marginBottom: 5, alignItems: "baseline" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color }}>{score} / 100</span>
      </div>
      <div
        style={{
          background: "var(--bg-2, #eee)",
          borderRadius: 4,
          height: 7,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${score}%`,
            height: "100%",
            background: color,
            transition: "width 0.5s ease",
            borderRadius: 4,
          }}
        />
      </div>
      {note && (
        <p className="sub small" style={{ marginTop: 4 }}>
          {note}
        </p>
      )}
    </div>
  );
}

function ScoreBreakdown({ scores, prospect }) {
  const bars = [
    {
      label: "Urgence des signaux",
      score: scores.urgency_score,
      note: `${scores.breakdown.signals_count} signal(s) · décroissance temporelle par type`,
    },
    {
      label: "Potentiel business",
      score: scores.business_score,
      note:
        scores.breakdown.firmographics_source === "sirene"
          ? "Données SIRENE vérifiées"
          : "Estimation — enrichir le compte SIREN pour affiner",
    },
    {
      label: "Accessibilité du contact",
      score: scores.accessibility_score,
      note: [
        prospect.email ? `email (${prospect.email_confidence || "?"})` : "email manquant",
        prospect.phone ? "téléphone" : null,
        prospect.linkedin_url ? "LinkedIn" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];

  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Score décomposé</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="sub small">Score algo :</span>
          <ScoreBadge score={scores.global_score} />
        </div>
      </div>
      <p className="sub small" style={{ marginBottom: 14 }}>
        Gate d'urgence ×{scores.breakdown.gate} — sans signal récent, le score est plafonné à 50.
        {scores.breakdown.top_signal && (
          <>
            {" "}Signal principal :{" "}
            <strong>{scores.breakdown.top_signal.type}</strong>
            {scores.breakdown.top_signal.date ? ` (${scores.breakdown.top_signal.date})` : ""}.
          </>
        )}
      </p>
      {bars.map((b) => (
        <ScoreBar key={b.label} {...b} />
      ))}
    </div>
  );
}

export default function ProspectPage() {
  const { id } = useParams();
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

  // Vérification des sources en arrière-plan après chargement de la recherche.
  useEffect(() => {
    if (!data?.research?.sources?.length) return;
    const urls = data.research.sources.filter((u) => u?.startsWith("http"));
    if (!urls.length) return;
    fetch("/api/verify-sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls }),
    })
      .then((r) => r.json())
      .then((d) => setSourceStatuses(d.results || {}))
      .catch(() => {});
  }, [data?.research?.id]);

  const scores = useMemo(() => {
    if (!data?.research?.signals) return null;
    try {
      return computeScores({
        prospect: data.prospect,
        signals: data.research.signals,
        firmographics: {},
      });
    } catch {
      return null;
    }
  }, [data?.research?.id, data?.prospect?.id]);

  const nba = useMemo(() => {
    if (!data) return null;
    return computeNba({ prospect: data.prospect, research: data.research, drafts: data.drafts });
  }, [data?.prospect?.id, data?.research?.id, data?.drafts?.id, data?.prospect?.status, data?.prospect?.email]);

  const run = async (endpoint, label, extraBody = {}) => {
    setBusy(label);
    setError("");
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId: id, ...extraBody }),
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const generate = () => {
    run("generate", "generate", selectedSignal ? { triggerSignal: selectedSignal } : {});
  };

  const toggleSignal = (signal) => {
    setSelectedSignal((prev) =>
      prev && prev.detail === signal.detail ? null : signal
    );
  };

  if (!data) return <div className="empty">{error || "Chargement…"}</div>;

  const { prospect, research, drafts } = data;

  return (
    <>
      <div className="row spread">
        <div>
          <h1>{prospect.first_name} {prospect.last_name}</h1>
          <p className="sub">
            {prospect.role || "Poste inconnu"} · {prospect.company}
            {prospect.linkedin_url && (
              <> · <a href={prospect.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></>
            )}
            {prospect.company_website && (
              <> · <a href={prospect.company_website} target="_blank" rel="noreferrer">Site ↗</a></>
            )}
            {prospect.account_id && (
              <> · <a href={`/accounts/${prospect.account_id}`}>Fiche compte ↗</a></>
            )}
          </p>
        </div>
        <ScoreBadge score={prospect.fit_score} />
      </div>

      {error && <div className="alert alert-err">{error}</div>}

      {nba && <NbaBanner nba={nba} />}

      <div className="row" style={{ margin: "12px 0 20px", flexWrap: "wrap", gap: 8 }}>
        <button className="btn-fox" disabled={!!busy} onClick={() => run("research", "research")}>
          {busy === "research" && <span className="spin" />}
          {research ? "Relancer la recherche" : "Lancer la recherche"}
        </button>
        <button disabled={!!busy || !research} onClick={generate}>
          {busy === "generate" && <span className="spin" />}
          {selectedSignal
            ? `Générer triggered — ${selectedSignal.type}`
            : drafts
              ? "Régénérer les brouillons"
              : "Générer les brouillons"}
        </button>
        {selectedSignal && (
          <button onClick={() => setSelectedSignal(null)} style={{ fontSize: 12 }}>
            × Annuler le signal trigger
          </button>
        )}
        {busy === "research" && (
          <span className="sub small">Recherche web en cours, 20-40 secondes…</span>
        )}
      </div>

      {!research && !busy && (
        <div className="card empty">
          <p>Pas encore de recherche. Lance-la : signaux d'achat, actualité, score de fit et angles d'accroche.</p>
        </div>
      )}

      {research && (
        <div className="card">
          <div className="row spread">
            <h2>Fiche de recherche</h2>
            <span className="sub small">
              {new Date(research.created_at).toLocaleString("fr-FR")}
            </span>
          </div>
          <p>{research.summary}</p>
          {research.fit_reason && (
            <p className="sub small">
              <strong>Pourquoi ce score :</strong> {research.fit_reason}
            </p>
          )}

          {(research.signals || []).length > 0 && (
            <>
              <div className="row spread" style={{ marginTop: 18, marginBottom: 6 }}>
                <h2 style={{ margin: 0 }}>Signaux détectés</h2>
                <span className="sub small">Clique sur un signal pour l'utiliser comme déclencheur</span>
              </div>
              {research.signals.map((s, i) => {
                const isSelected = selectedSignal && selectedSignal.detail === s.detail;
                return (
                  <div
                    key={i}
                    className="signal"
                    onClick={() => toggleSignal(s)}
                    style={{
                      cursor: "pointer",
                      outline: isSelected ? "2px solid var(--accent)" : "none",
                      borderRadius: 6,
                      transition: "outline 0.1s",
                    }}
                  >
                    <div>
                      <strong>{s.type}</strong>
                      {isSelected && (
                        <span style={{ color: "var(--accent)", marginLeft: 8, fontSize: 12 }}>
                          ⚡ trigger
                        </span>
                      )}
                      {" — "}{s.detail}
                    </div>
                    <div className="meta">
                      {s.date}{s.source && <> · {s.source}</>}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {(research.hooks || []).length > 0 && (
            <>
              <h2 style={{ marginTop: 18 }}>Angles d'accroche</h2>
              {research.hooks.map((h, i) => (
                <div key={i} className="hook">
                  <div className="angle">{i + 1}. {h.angle}</div>
                  <div className="sub small">{h.pourquoi}</div>
                  {h.phrase && <div className="phrase">« {h.phrase} »</div>}
                </div>
              ))}
            </>
          )}

          {(research.sources || []).length > 0 && (
            <p className="sub small" style={{ marginTop: 12 }}>
              Sources :{" "}
              {research.sources.map((u, i) => {
                const status = sourceStatuses[u];
                return (
                  <span key={i} style={{ marginRight: 6 }}>
                    <a href={u} target="_blank" rel="noreferrer">[{i + 1}]</a>
                    {status !== undefined && <SourceBadge url={u} verified={status?.ok} />}
                    {" "}
                  </span>
                );
              })}
            </p>
          )}
        </div>
      )}

      {/* ── Score décomposé — affiché quand la recherche a des signaux ── */}
      {research && scores && (
        <ScoreBreakdown scores={scores} prospect={prospect} />
      )}

      {drafts && (
        <div className="card">
          <h2>Brouillons — à relire, ajuster, puis envoyer toi-même</h2>

          <div className="copybar">
            <h3>Email · objet : {drafts.email_subject}</h3>
            <CopyButton text={`Objet : ${drafts.email_subject}\n\n${drafts.email_body}`} />
          </div>
          <div className="draft">{drafts.email_body}</div>

          <div className="copybar">
            <h3>Message LinkedIn ({(drafts.linkedin_message || "").length} caractères)</h3>
            <CopyButton text={drafts.linkedin_message} />
          </div>
          <div className="draft">{drafts.linkedin_message}</div>

          <div className="copybar">
            <h3>Points d'ouverture pour l'appel</h3>
            <CopyButton text={(drafts.call_points || []).join("\n")} />
          </div>
          <div className="draft">
            {(drafts.call_points || []).map((c, i) => `${i + 1}. ${c}`).join("\n")}
          </div>
        </div>
      )}

      <ContactCard prospect={prospect} onSaved={load} />

      <div className="card">
        <h2>Notes</h2>
        <NotesEditor prospect={prospect} />
      </div>
    </>
  );
}

function ContactCard({ prospect, onSaved }) {
  const [email, setEmail] = useState(prospect.email || "");
  const [phone, setPhone] = useState(prospect.phone || "");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrichment, setEnrichment] = useState(null);

  const save = async (fields) => {
    setErr("");
    const res = await fetch(`/api/prospects/${prospect.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) {
      setErr(d.error || `Erreur ${res.status} lors de l'enregistrement.`);
      return false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    onSaved && onSaved();
    return true;
  };

  const enrich = async () => {
    setBusy(true);
    setErr("");
    setEnrichment(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId: prospect.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) setErr(d.error || `Erreur ${res.status} pendant l'enrichissement.`);
      else {
        setEnrichment(d.enrichment);
        if (d.prospect?.email) setEmail(d.prospect.email);
        if (d.prospect?.phone) setPhone(d.prospect.phone);
        onSaved && onSaved();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const suggestionDiffers =
    enrichment?.email &&
    prospect.email &&
    enrichment.email.toLowerCase() !== prospect.email.toLowerCase();

  return (
    <div className="card">
      <div className="row spread">
        <h2>Coordonnées</h2>
        <button disabled={busy} onClick={enrich}>
          {busy && <span className="spin spin-dark" />}
          {busy ? "Recherche en cours…" : "🔍 Enrichir automatiquement"}
        </button>
      </div>
      {busy && (
        <p className="sub small">Recherche web du pattern d'email et du standard, 20-60 secondes…</p>
      )}

      {err && <div className="alert alert-err">{err}</div>}

      {enrichment && (
        <div className={`alert ${enrichment.email || enrichment.phone ? "alert-ok" : "alert-err"}`}>
          {enrichment.email ? (
            <>
              Email proposé : <strong>{enrichment.email}</strong>{" "}
              (confiance {enrichment.email_confidence || "?"})
              {enrichment.email_source && (
                <span className="small"> — {enrichment.email_source}</span>
              )}
            </>
          ) : (
            <>Aucun email trouvé avec certitude.</>
          )}
          {enrichment.phone && <><br />Standard : <strong>{enrichment.phone}</strong></>}
          {suggestionDiffers && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => { setEmail(enrichment.email); save({ email: enrichment.email }); }}
              >
                Remplacer par l'email proposé
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid2">
        <div>
          <label>Email pro</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="prenom.nom@entreprise.fr"
          />
          {prospect.email_confidence && (
            <p className="sub small" style={{ marginTop: 4 }}>
              Confiance : {prospect.email_confidence}
              {prospect.email_source ? ` — ${prospect.email_source}` : ""}
            </p>
          )}
        </div>
        <div>
          <label>Téléphone (standard)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+33 1 23 45 67 89"
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          onClick={() => save({ email: email.trim() || null, phone: phone.trim() || "" })}
        >
          {saved ? "Enregistré ✓" : "Enregistrer les coordonnées"}
        </button>
      </div>
    </div>
  );
}

function NotesEditor({ prospect }) {
  const [notes, setNotes] = useState(prospect.notes || "");
  const [saved, setSaved] = useState(false);
  return (
    <>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Compte-rendu d'appel, contexte, prochaine étape…"
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button
          onClick={async () => {
            await fetch(`/api/prospects/${prospect.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ notes }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 1600);
          }}
        >
          {saved ? "Enregistré ✓" : "Enregistrer les notes"}
        </button>
      </div>
    </>
  );
}
