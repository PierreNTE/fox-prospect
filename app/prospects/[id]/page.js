"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

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

export default function ProspectPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch(`/api/prospects/${id}`);
    const d = await res.json();
    if (d.error) setError(d.error);
    else setData(d);
  };

  useEffect(() => { load(); }, [id]);

  const run = async (endpoint, label) => {
    setBusy(label);
    setError("");
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId: id }),
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

  if (!data) return <div className="empty">{error || "Chargement…"}</div>;

  const { prospect, research, drafts } = data;

  return (
    <>
      <div className="row spread">
        <div>
          <h1>{prospect.first_name} {prospect.last_name}</h1>
          <p className="sub">
            {prospect.role || "Poste inconnu"} · {prospect.company}
            {prospect.linkedin_url && <> · <a href={prospect.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></>}
            {prospect.company_website && <> · <a href={prospect.company_website} target="_blank" rel="noreferrer">Site ↗</a></>}
            {prospect.account_id && <> · <a href={`/accounts/${prospect.account_id}`}>Fiche compte ↗</a></>}
          </p>
        </div>
        <ScoreBadge score={prospect.fit_score} />
      </div>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="row" style={{ margin: "14px 0 22px" }}>
        <button className="btn-fox" disabled={!!busy} onClick={() => run("research", "research")}>
          {busy === "research" && <span className="spin" />}
          {research ? "Relancer la recherche" : "Lancer la recherche"}
        </button>
        <button disabled={!!busy || !research} onClick={() => run("generate", "generate")}>
          {busy === "generate" && <span className="spin" />}
          {drafts ? "Régénérer les brouillons" : "Générer les brouillons"}
        </button>
        {busy === "research" && <span className="sub small">Recherche web en cours, 20-40 secondes…</span>}
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
            <span className="sub small">{new Date(research.created_at).toLocaleString("fr-FR")}</span>
          </div>
          <p>{research.summary}</p>
          {research.fit_reason && (
            <p className="sub small"><strong>Pourquoi ce score :</strong> {research.fit_reason}</p>
          )}

          {(research.signals || []).length > 0 && (
            <>
              <h2 style={{ marginTop: 18 }}>Signaux détectés</h2>
              {research.signals.map((s, i) => (
                <div key={i} className="signal">
                  <div><strong>{s.type}</strong> — {s.detail}</div>
                  <div className="meta">{s.date} {s.source && <>· {s.source}</>}</div>
                </div>
              ))}
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
              Sources : {research.sources.map((u, i) => (
                <span key={i}><a href={u} target="_blank" rel="noreferrer">[{i + 1}]</a>{" "}</span>
              ))}
            </p>
          )}
        </div>
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
    enrichment?.email && prospect.email && enrichment.email.toLowerCase() !== prospect.email.toLowerCase();

  return (
    <div className="card">
      <div className="row spread">
        <h2>Coordonnées</h2>
        <button disabled={busy} onClick={enrich}>
          {busy && <span className="spin spin-dark" />}
          {busy ? "Recherche en cours…" : "🔍 Enrichir automatiquement"}
        </button>
      </div>
      {busy && <p className="sub small">Recherche web du pattern d'email et du standard, 20-60 secondes…</p>}

      {err && <div className="alert alert-err">{err}</div>}

      {enrichment && (
        <div className={`alert ${enrichment.email || enrichment.phone ? "alert-ok" : "alert-err"}`}>
          {enrichment.email ? (
            <>Email proposé : <strong>{enrichment.email}</strong> (confiance {enrichment.email_confidence || "?"})
              {enrichment.email_source && <span className="small"> — {enrichment.email_source}</span>}</>
          ) : (
            <>Aucun email trouvé avec certitude. {enrichment.notes}</>
          )}
          {enrichment.phone && <><br />Standard : <strong>{enrichment.phone}</strong></>}
          {suggestionDiffers && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => { setEmail(enrichment.email); save({ email: enrichment.email }); }}>
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
              Confiance : {prospect.email_confidence}{prospect.email_source ? ` — ${prospect.email_source}` : ""}
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
        <button onClick={() => save({ email: email.trim() || null, phone: phone.trim() || "" })}>
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
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Compte-rendu d'appel, contexte, prochaine étape…" />
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
