"use client";

// Session d'appels : les leads à appeler aujourd'hui, un par un.
// Sur ordinateur, le numéro s'affiche en QR code (à scanner avec l'iPhone) ;
// sur téléphone, un bouton lance l'appel. Le résultat se note en un clic et
// la session passe au lead suivant.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Card, Button, Title2, Title3, Body1, Caption1, Badge, Textarea, Input, ProgressBar,
} from "@fluentui/react-components";
import { ArrowLeft24Regular, ArrowRight24Regular, Copy24Regular, Mail24Regular, Phone24Regular, Search24Regular } from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import { sfStatusLabel, sfStatusRank, CALL_STATUS_META } from "@/lib/call-status";
import { buildCallQueue, primaryNumber, OUTCOMES, outcomePatch, addBusinessDays, telHref } from "@/lib/call-session";
import { NO_ANSWER_LIMIT } from "@/lib/call-history";
import PhoneQr from "@/components/PhoneQr";
import CallButton, { useIsPhone, copyText } from "@/components/CallButton";

const today = () => new Date().toISOString().slice(0, 10);

// Mise à jour locale du compteur d'appels après un résultat (sans recharger la liste).
const afterCall = (l, outcome) => ({
  attempts: (l.attempts || 0) + 1,
  no_answer_streak: outcome === "pas_joignable" ? (l.no_answer_streak || 0) + 1 : 0,
  calls: [...(l.calls || []), { outcome, at: new Date().toISOString() }],
});

function Section({ title, children }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <Caption1 style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--colorNeutralForeground3)" }}>
        {title}
      </Caption1>
      {children}
    </div>
  );
}

function standardScript(l) {
  const c = l.contact;
  if (c?.name) {
    return `Bonjour, je vous appelle de la part de Dell Technologies. Je cherche à joindre ${c.name}${c.role ? ` (${c.role})` : ""}, pouvez-vous me le passer s'il vous plaît ?`;
  }
  return "Bonjour, je vous appelle de la part de Dell Technologies. Je cherche à joindre la personne qui s'occupe de l'informatique (serveurs, stockage, postes). Pouvez-vous me la passer, ou me donner son nom ?";
}

function NumberBlock({ l, isPhone }) {
  const main = primaryNumber(l);
  const [copied, setCopied] = useState(false);
  if (!main) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <Body1>Pas encore de numéro pour cette société.</Body1>
        <Button as="a" appearance="primary" icon={<Search24Regular />} href={l.phone_search_url} target="_blank" rel="noreferrer">
          Trouver le standard
        </Button>
        <Caption1>Colle ensuite le numéro sur la fiche de la société.</Caption1>
      </div>
    );
  }
  const label = main.kind === "contact" ? `${l.contact.name}` : "Standard";
  const other = main.kind === "contact" && l.standard?.number ? l.standard.number : null;
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      {isPhone ? (
        <Button as="a" size="large" appearance="primary" icon={<Phone24Regular />} href={telHref(main.number)}
          style={{ minWidth: 240, minHeight: 56, fontSize: 18 }}>
          {label} · {main.number}
        </Button>
      ) : (
        <PhoneQr number={main.number} size={170} />
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {!isPhone && (
          <>
            <Caption1>{label}</Caption1>
            <Title3>{main.number}</Title3>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Scanne avec l&apos;appareil photo de l&apos;iPhone, puis « Appeler ».
            </Caption1>
            <div>
              <Button size="small" icon={<Copy24Regular />} onClick={async () => setCopied(await copyText(main.number))}>
                {copied ? "Copié" : "Copier"}
              </Button>
            </div>
          </>
        )}
        {other && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Caption1>Sinon :</Caption1>
            <CallButton appearance="outline" number={other} label={`Standard ${other}`} who={`Standard — ${l.name}`} />
          </div>
        )}
      </div>
    </div>
  );
}

// ID du lead Salesforce : copié pour le retrouver en un coup dans Salesforce.
function LeadId({ id }) {
  const [copied, setCopied] = useState(false);
  return (
    <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
      Lead Salesforce {id}{" "}
      <Button size="small" appearance="transparent" icon={<Copy24Regular />} onClick={async () => setCopied(await copyText(id))}
        aria-label="Copier l'ID du lead">
        {copied ? "Copié" : ""}
      </Button>
    </Caption1>
  );
}

// Email du lead : déjà confié à l'agent Sales Chat, ou brouillon Outlook en un clic
// (pratique juste après un répondeur : « je viens de vous laisser un message »).
function EmailLine({ l }) {
  const exported = l.email_exported_at ? new Date(l.email_exported_at).toLocaleDateString("fr-FR") : null;
  const mailto = l.email_subject
    ? `mailto:${l.email.email}?subject=${encodeURIComponent(l.email_subject)}&body=${encodeURIComponent(l.email_body || "")}`
    : `mailto:${l.email.email}`;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Caption1 style={{ color: "var(--colorNeutralForeground2)", wordBreak: "break-all" }}>
        ✉ {l.recipient?.name ? `${l.recipient.name} · ` : ""}{l.email.email} · {l.email.confidence}
      </Caption1>
      {l.last_email_at ? (
        <Caption1 style={{ color: l.email_replied ? "#107C10" : "var(--colorNeutralForeground3)" }}>
          {l.email_replied ? "a répondu à ton email" : l.email_status === "non_remis" ? "email non remis" : "email envoyé"} le {new Date(l.last_email_at).toLocaleDateString("fr-FR")}
        </Caption1>
      ) : exported ? (
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>email confié à l&apos;agent Sales Chat le {exported}</Caption1>
      ) : (
        <Button as="a" size="small" appearance="subtle" icon={<Mail24Regular />} href={mailto}>Préparer l&apos;email</Button>
      )}
    </div>
  );
}

export default function SessionClient({ initialLeads }) {
  const day = today();
  const isPhone = useIsPhone();
  // La file est figée au début de la session : un lead traité n'en sort pas
  // (on peut revenir en arrière pour corriger), et l'ordre ne bouge pas.
  const [queue] = useState(() => buildCallQueue(initialLeads, day).map((l) => l.id));
  const [byId, setById] = useState(() => Object.fromEntries((initialLeads || []).map((l) => [l.id, l])));
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState({});
  const [recallFor, setRecallFor] = useState(null);
  const [recallDate, setRecallDate] = useState(addBusinessDays(day, 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState({}); // id → outcome noté pendant la session

  const l = byId[queue[index]];
  const note = l ? (notes[l.id] ?? l.call_note ?? "") : "";
  const tally = useMemo(() => {
    const t = {};
    for (const o of Object.values(results)) t[o] = (t[o] || 0) + 1;
    return t;
  }, [results]);

  async function record(outcome, recallAt) {
    if (!l) return;
    setSaving(true); setError(null);
    const r = await fetchJson(`/api/accounts/${l.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(outcomePatch(outcome, { day, recallAt, note })),
    });
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    setResults((m) => ({ ...m, [l.id]: outcome }));
    setRecallFor(null);
    if (outcome === "faux_numero") {
      // On reste sur la société avec le numéro suivant (recalculé côté serveur).
      const fresh = await fetchJson("/api/leads");
      const next = fresh.ok ? (fresh.data.leads || []).find((x) => x.id === l.id) : null;
      setById((m) => ({ ...m, [l.id]: next || { ...m[l.id], ...r.data.account, ...afterCall(m[l.id], outcome), standard: null } }));
      return;
    }
    setById((m) => ({ ...m, [l.id]: { ...m[l.id], ...r.data.account, ...afterCall(m[l.id], outcome) } }));
    setIndex((i) => i + 1);
  }

  if (!queue.length) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
        <Link href="/leads"><Button appearance="subtle" icon={<ArrowLeft24Regular />}>Leads</Button></Link>
        <Card style={{ padding: 20 }}>
          <Title3>Rien à appeler aujourd&apos;hui</Title3>
          <Body1>
            Tous les leads ouverts ont un résultat, un rappel prévu plus tard, ou la liste est vide.
            Importe la liste de la semaine depuis la page Leads.
          </Body1>
        </Card>
      </div>
    );
  }

  if (!l) {
    const n = Object.keys(results).length;
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
        <Card style={{ padding: 20, display: "grid", gap: 10 }}>
          <Title2>Session terminée</Title2>
          <Body1>{n} appel{n > 1 ? "s" : ""} noté{n > 1 ? "s" : ""}.</Body1>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {OUTCOMES.filter((o) => tally[o.value]).map((o) => (
              <Badge key={o.value} appearance="tint" color={CALL_STATUS_META[o.value]?.color || "informative"}>
                {o.short} : {tally[o.value]}
              </Badge>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => setIndex(Math.max(0, queue.length - 1))}>Revenir au dernier lead</Button>
            <Link href="/leads"><Button appearance="primary">Retour aux leads</Button></Link>
          </div>
        </Card>
      </div>
    );
  }

  const b = l.brief || {};
  const noted = results[l.id];
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link href="/leads"><Button appearance="subtle" icon={<ArrowLeft24Regular />}>Leads</Button></Link>
        <Body1 style={{ fontWeight: 700 }}>Session d&apos;appels · {index + 1} / {queue.length}</Body1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Button appearance="subtle" disabled={index === 0 || saving} onClick={() => { setRecallFor(null); setIndex((i) => i - 1); }}>
            Précédent
          </Button>
          <Button appearance="subtle" icon={<ArrowRight24Regular />} iconPosition="after" disabled={saving}
            onClick={() => { setRecallFor(null); setIndex((i) => i + 1); }}>
            Passer
          </Button>
        </div>
      </div>
      <ProgressBar value={(index) / queue.length} />

      <Card style={{ padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Link href={`/accounts/${l.id}`} target="_blank" style={{ textDecoration: "none" }}>
              <Title3>{l.name}</Title3>
            </Link>
            {l.sf_lead_status && (
              <Badge appearance="outline" size="small" color={sfStatusRank(l.sf_lead_status) === 0 ? "brand" : "informative"}>
                {sfStatusLabel(l.sf_lead_status)}
              </Badge>
            )}
            {b.verdict_label && <Badge appearance="tint" color={b.verdict_color || "informative"}>{b.verdict_label}</Badge>}
            {l.recall_at && <Badge appearance="tint" color="important">Rappel prévu</Badge>}
            {l.attempts > 0 && <Badge appearance="tint" color="informative">{l.attempts + 1}e appel</Badge>}
            {noted && <Badge appearance="filled" color="success">Noté : {OUTCOMES.find((o) => o.value === noted)?.short}</Badge>}
          </div>
          <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>
            {[l.etab_commune || l.commune, b.reason].filter(Boolean).join(" · ")}
          </Caption1>
          {l.sf_lead_id && <LeadId id={l.sf_lead_id} />}
          {(b.anomalies || []).length > 0 && (
            <Caption1 style={{ color: "#8A6A00" }}>⚠ {b.anomalies.map((a) => a.label).join(" · ")}</Caption1>
          )}
          {(l.no_answer_streak || 0) >= NO_ANSWER_LIMIT && (
            <Caption1 style={{ color: "#8A6A00" }}>
              {l.no_answer_streak} essais sans réponse d&apos;affilée : tente l&apos;autre numéro ou demande un autre interlocuteur
              au standard. La relance par email reste à l&apos;agent Sales Chat.
            </Caption1>
          )}
          {l.call_note && !notes[l.id] && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Dernière note : {l.call_note}</Caption1>
          )}
        </div>

        <Section title="Qui appeler">
          <Body1 style={{ fontWeight: 600 }}>
            {l.contact ? `${l.contact.name} — ${l.contact.role || "poste à confirmer"}` : "Demander le responsable informatique"}
            {l.people_count > 1 && <Caption1> · {l.people_count - 1} autre{l.people_count > 2 ? "s" : ""} sur la fiche</Caption1>}
          </Body1>
          <NumberBlock l={l} isPhone={isPhone} />
        </Section>

        {(primaryNumber(l)?.kind !== "contact") && (
          <Section title="Au standard">
            <Body1>{standardScript(l)}</Body1>
          </Section>
        )}

        {(l.hook || l.question) && (
          <Section title="Accroche">
            {l.hook && <Body1>{l.hook}</Body1>}
            {l.question && <Body1 style={{ fontStyle: "italic" }}>« {l.question} »</Body1>}
          </Section>
        )}

        {l.email && !l.email_opt_out && <EmailLine l={l} />}

        <Section title="Note">
          <Textarea value={note} resize="vertical" placeholder="Ce que tu as appris (nom du RI, projet, rappel…)"
            onChange={(_, d) => setNotes((m) => ({ ...m, [l.id]: d.value }))} />
        </Section>

        <Section title="Résultat">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {OUTCOMES.map((o) => (
              <Button key={o.value} appearance={o.appearance} disabled={saving}
                onClick={() => (o.value === "rappeler" ? setRecallFor(l.id) : record(o.value))}
                style={{ minHeight: 44 }}>
                {o.label}
              </Button>
            ))}
          </div>
          {recallFor === l.id && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Caption1>Rappeler le</Caption1>
              <Input type="date" value={recallDate} min={day} onChange={(_, d) => setRecallDate(d.value)} />
              <Button appearance="primary" disabled={saving || !recallDate} onClick={() => record("rappeler", recallDate)}>
                Valider
              </Button>
            </div>
          )}
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
            Répondeur : rappel programmé dans 2 jours ouvrés. Faux numéro : le numéro est écarté, le suivant prend sa place.
          </Caption1>
          {error && <Caption1 style={{ color: "#C50F1F" }}>{error}</Caption1>}
        </Section>
      </Card>
    </div>
  );
}
