"use client";

// Fiche d'approche : coordonnées publiques, interlocuteurs IT, actu, et
// messages prêts à envoyer (email, LinkedIn, relance) + séquence de relances.
// L'envoi reste manuel et en un clic : l'email s'ouvre dans la messagerie du
// poste (Outlook), déjà rempli.
import { useMemo, useState } from "react";
import { Card, Body1, Caption1, Button, Spinner, Select, Badge } from "@fluentui/react-components";
import {
  Sparkle24Regular, Copy24Regular, Mail24Regular, Phone24Regular, Globe24Regular,
  LinkSquare24Regular, CalendarAdd24Regular, Checkmark24Regular, PersonSearch24Regular,
} from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";

const BRAND = "#5B53E6";

function Section({ title, children, right }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <Body1 style={{ fontWeight: 700, fontSize: 14 }}>{title}</Body1>
        {right}
      </div>
      {children}
    </div>
  );
}

const Line = ({ children }) => (
  <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)", padding: "3px 0", lineHeight: 1.55 }}>
    {children}
  </Caption1>
);

function CopyButton({ text, label = "Copier" }) {
  const [ok, setOk] = useState(false);
  return (
    <Button size="small" appearance="subtle" icon={ok ? <Checkmark24Regular /> : <Copy24Regular />}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); } catch {}
      }}>
      {ok ? "Copié" : label}
    </Button>
  );
}

const Pre = ({ children }) => (
  <pre style={{
    margin: "4px 0 0", padding: 10, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.5,
    background: "var(--colorNeutralBackground3)", fontFamily: "inherit",
  }}>{children}</pre>
);

const mailto = (to, subject, body) =>
  `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body || "")}`;

const linkedinSearch = (name, company) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company}`.trim())}`;

export default function CallPrepCard({ accountId, accountName, contacts = [], prep, generatedAt, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [planning, setPlanning] = useState(false);

  // Destinataires possibles : contacts de l'organigramme avec un email, puis l'email générique.
  const recipients = useMemo(() => {
    const list = contacts
      .filter((c) => (c.email || "").trim())
      .map((c) => ({ email: c.email.trim(), label: `${c.first_name} ${c.last_name}`.trim() + (c.role ? ` — ${c.role}` : "") }));
    const gen = prep?.coordonnees?.email_generique;
    if (gen && !list.some((r) => r.email === gen)) list.push({ email: gen, label: `${gen} (générique)` });
    return list;
  }, [contacts, prep]);
  const [to, setTo] = useState("");
  const dest = to || recipients[0]?.email || "";

  async function run(force) {
    setBusy(true); setNote(""); onError?.("");
    const r = await fetchJson("/api/call-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, force: !!force }),
    });
    setBusy(false);
    if (!r.ok) { onError?.(r.error); return; }
    if (r.data?.contacts_added) setNote(`${r.data.contacts_added} interlocuteur(s) ajouté(s) aux contacts du compte.`);
    onDone?.();
  }

  // Séquence multicanal → tâches datées dans l'Agenda (rien n'est envoyé automatiquement).
  async function planSequence() {
    if (!prep) return;
    setPlanning(true); onError?.("");
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const m = prep.messages || {};
    const steps = [
      { d: 0, kind: "email", title: `Email d'accroche — ${accountName}`, notes: `${m.email?.objet || ""}\n\n${m.email?.corps || ""}` },
      { d: 0, kind: "linkedin", title: `Invitation LinkedIn — ${accountName}`, notes: m.linkedin_invitation || "" },
      { d: 3, kind: "appel", title: `Appel — ${accountName}`, notes: prep.coordonnees?.standard ? `Standard : ${prep.coordonnees.standard}` : "" },
      { d: 7, kind: "relance", title: `Email de relance — ${accountName}`, notes: `${m.relance?.objet || ""}\n\n${m.relance?.corps || ""}` },
    ];
    for (const s of steps) {
      const r = await fetchJson("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: s.title, kind: s.kind, due_date: day(s.d), account_id: accountId, notes: s.notes }),
      });
      if (!r.ok) { onError?.(r.error); setPlanning(false); return; }
    }
    setPlanning(false);
    setNote("Séquence planifiée dans l'Agenda : email + LinkedIn aujourd'hui, appel à J+3, relance à J+7.");
  }

  const c = prep?.coordonnees || {};
  const m = prep?.messages || {};

  return (
    <Card style={{ padding: "20px 20px 22px", borderLeft: `3px solid ${BRAND}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PersonSearch24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Fiche d'approche</Body1>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {prep && (
            <Button size="small" appearance="outline" disabled={planning}
              icon={planning ? <Spinner size="tiny" /> : <CalendarAdd24Regular />} onClick={planSequence}>
              Planifier la séquence
            </Button>
          )}
          <Button appearance={prep ? "outline" : "primary"} size="small" disabled={busy}
            icon={busy ? <Spinner size="tiny" /> : <Sparkle24Regular />} onClick={() => run(!!prep)}>
            {busy ? "Recherche… (≈ 1 min)" : prep ? "Régénérer" : "Préparer (IA + web)"}
          </Button>
        </div>
      </div>

      {!prep && !busy && (
        <Caption1 style={{ display: "block", marginTop: 10, color: "var(--colorNeutralForeground2)", lineHeight: 1.6 }}>
          Trouve le responsable informatique et les coordonnées publiques de la société (standard, email, LinkedIn),
          son actualité, et rédige l'email, le message LinkedIn et la relance. Les interlocuteurs trouvés sont ajoutés
          aux contacts du compte.
        </Caption1>
      )}
      {note && <Caption1 style={{ display: "block", marginTop: 8, color: "#107C10" }}>{note}</Caption1>}

      {prep && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
          {prep.identite && <Body1 style={{ lineHeight: 1.6, color: "var(--colorNeutralForeground2)" }}>{prep.identite}</Body1>}

          <Section title="Coordonnées">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {c.standard && (
                <Button as="a" href={`tel:${c.standard.replace(/[^\d+]/g, "")}`} size="small" icon={<Phone24Regular />}>
                  Standard {c.standard}
                </Button>
              )}
              {c.site && (
                <Button as="a" href={c.site} target="_blank" rel="noreferrer" size="small" icon={<Globe24Regular />}>
                  Site web
                </Button>
              )}
              {c.email_generique && (
                <Button as="a" href={`mailto:${c.email_generique}`} size="small" icon={<Mail24Regular />}>
                  {c.email_generique}
                </Button>
              )}
            </div>
            {c.format_email && (
              <Line>Format des emails : <strong>{c.format_email}</strong>{c.format_source ? ` (observé : ${c.format_source})` : ""}</Line>
            )}
            {c.adresse && <Line>Siège : {c.adresse}</Line>}
            {!c.standard && !c.email_generique && <Line>Aucune coordonnée publique trouvée — à compléter avec ZoomInfo.</Line>}
          </Section>

          <Section title="Interlocuteurs IT">
            {prep.contacts?.length ? prep.contacts.map((p, i) => (
              <Line key={i}>
                <strong>{p.prenom} {p.nom}</strong> — {p.poste || "poste à confirmer"}{" "}
                <Badge size="small" appearance="tint" color={p.confiance === "haute" ? "success" : p.confiance === "moyenne" ? "warning" : "informative"}>
                  {p.confiance}
                </Badge>
                {p.pourquoi ? <><br />{p.pourquoi}</> : null}
                <br />
                <a href={p.linkedin_url || linkedinSearch(`${p.prenom} ${p.nom}`, accountName)} target="_blank" rel="noreferrer">
                  {p.linkedin_url ? "Profil LinkedIn" : "Chercher sur LinkedIn"}
                </a>
                {p.source && /^https?:/.test(p.source) ? <> · <a href={p.source} target="_blank" rel="noreferrer">source</a></> : null}
              </Line>
            )) : <Line>Personne identifiée publiquement.</Line>}
            {prep.postes_a_chercher?.length > 0 && (
              <Line>À chercher dans ZoomInfo : {prep.postes_a_chercher.join(" · ")}</Line>
            )}
            {prep.it_externalisee && <Line>⚠️ IT probablement externalisée : {prep.it_externalisee}</Line>}
            <Line>Ajoutés aux contacts du compte ci-dessous : bouton « Enrichir » pour chercher email et téléphone.</Line>
          </Section>

          {prep.actus?.length > 0 && (
            <Section title="Actualité">
              {prep.actus.map((a, i) => (
                <Line key={i}>
                  <strong>{a.titre}</strong>{a.date ? ` · ${a.date}` : ""}
                  {a.source && /^https?:/.test(a.source) ? <> · <a href={a.source} target="_blank" rel="noreferrer">source</a></> : null}
                </Line>
              ))}
            </Section>
          )}
          {prep.angle && <Line><strong>Angle :</strong> {prep.angle}</Line>}

          {(m.email?.corps) && (
            <Section title="Email de premier contact" right={
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                {recipients.length > 0 && (
                  <Select size="small" value={dest} onChange={(_, d) => setTo(d.value)} aria-label="Destinataire">
                    {recipients.map((r) => <option key={r.email} value={r.email}>{r.label}</option>)}
                  </Select>
                )}
                <Button as="a" size="small" appearance="primary" icon={<Mail24Regular />} href={mailto(dest, m.email.objet, m.email.corps)}>
                  Ouvrir dans Outlook
                </Button>
                <CopyButton text={`${m.email.objet}\n\n${m.email.corps}`} />
              </div>
            }>
              <Pre><strong>Objet : {m.email.objet}</strong>{"\n\n"}{m.email.corps}</Pre>
            </Section>
          )}

          {(m.linkedin_invitation || m.linkedin_message) && (
            <Section title="LinkedIn" right={prep.contacts?.[0] && (
              <Button as="a" size="small" icon={<LinkSquare24Regular />} target="_blank" rel="noreferrer"
                href={prep.contacts[0].linkedin_url || linkedinSearch(`${prep.contacts[0].prenom} ${prep.contacts[0].nom}`, accountName)}>
                Ouvrir le profil
              </Button>
            )}>
              {m.linkedin_invitation && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Caption1>Invitation ({m.linkedin_invitation.length} car.)</Caption1>
                    <CopyButton text={m.linkedin_invitation} />
                  </div>
                  <Pre>{m.linkedin_invitation}</Pre>
                </>
              )}
              {m.linkedin_message && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                    <Caption1>Message après acceptation</Caption1>
                    <CopyButton text={m.linkedin_message} />
                  </div>
                  <Pre>{m.linkedin_message}</Pre>
                </>
              )}
            </Section>
          )}

          {m.relance?.corps && (
            <Section title="Relance J+7" right={
              <div style={{ display: "flex", gap: 4 }}>
                <Button as="a" size="small" icon={<Mail24Regular />} href={mailto(dest, m.relance.objet, m.relance.corps)}>
                  Ouvrir dans Outlook
                </Button>
                <CopyButton text={`${m.relance.objet}\n\n${m.relance.corps}`} />
              </div>
            }>
              <Pre><strong>Objet : {m.relance.objet}</strong>{"\n\n"}{m.relance.corps}</Pre>
            </Section>
          )}

          {prep.standard?.phrases?.length > 0 && (
            <Section title="Passer le standard">
              {prep.standard.phrases.map((p, i) => <Line key={i}>« {p} »</Line>)}
              {prep.standard.si_mail && <Line><strong>« Envoyez un mail »</strong> → {prep.standard.si_mail}</Line>}
            </Section>
          )}

          {generatedAt && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Préparée le {new Date(generatedAt).toLocaleString("fr-FR")} · vérifie les informations avant envoi
            </Caption1>
          )}
        </div>
      )}
    </Card>
  );
}
