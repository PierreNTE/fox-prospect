"use client";

// Fiche d'un lead, recentrée sur trois questions avant d'appeler :
//   1. La société existe-t-elle encore ?   → bandeau d'état + carte Santé
//   2. Qui appeler, à quel numéro ?        → « Qui appeler » (contacts du compte)
//   3. Avec quelle accroche ?              → « Accroche et messages »
// + le suivi d'appel (statut, rappel, note) qui remplace agenda et pipeline.
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card, Body1, Caption1, Title2, Button, Badge, Spinner, Input, Select, Textarea,
} from "@fluentui/react-components";
import {
  ArrowLeft24Regular, Mail24Regular, Globe24Regular, LinkSquare24Regular,
  PersonAdd24Regular, Delete24Regular, People24Regular, ChevronDown24Regular, ChevronUp24Regular, Search24Regular,
} from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";
import { HEALTH_META } from "@/lib/health-meta";
import { CALL_STATUS, CALL_STATUS_META, sfStatusLabel } from "@/lib/call-status";
import HealthCard from "@/components/HealthCard";
import IntelCard from "@/components/IntelCard";
import CallPrepCard from "@/components/CallPrepCard";
import BriefCard from "@/components/BriefCard";
import ZoomInfoButton from "@/components/ZoomInfoButton";
import CallButton from "@/components/CallButton";
import { whoToCall, pickEmail } from "@/lib/who-to-call";

const BRAND = "#5B53E6";
const RED = "#C50F1F";
const GREEN = "#107C10";

const linkedinSearch = (name, company) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company}`.trim())}`;

/* ── Suivi d'appel ─────────────────────────────────────────────────────── */
function CallTracker({ account, onSaved, onError }) {
  const [status, setStatus] = useState(account.call_status || "a_appeler");
  const [recall, setRecall] = useState(account.recall_at ? String(account.recall_at).slice(0, 10) : "");
  const [note, setNote] = useState(account.call_note || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(next = {}) {
    setSaving(true); onError("");
    const body = { call_status: status, recall_at: recall, call_note: note, ...next };
    const r = await fetchJson(`/api/accounts/${account.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) { onError(r.error); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    onSaved();
  }

  const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  return (
    <Card style={{ padding: "14px 18px" }}>
      <Body1 style={{ fontWeight: 700, display: "block", marginBottom: 8 }}>Suivi d'appel</Body1>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CALL_STATUS.map((s) => (
          <Button key={s.value} size="small" appearance={status === s.value ? "primary" : "outline"} disabled={saving}
            onClick={() => {
              setStatus(s.value);
              const r = s.value === "rappeler" && !recall ? plusDays(2) : recall;
              if (r !== recall) setRecall(r);
              save({ call_status: s.value, recall_at: r });
            }}>
            {s.label}
          </Button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4 }}>Rappeler le</Caption1>
          <Input type="date" value={recall} onChange={(_, d) => setRecall(d.value)} onBlur={() => save()} />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["Demain", 1], ["J+3", 3], ["J+7", 7]].map(([l, n]) => (
            <Button key={l} size="small" appearance="subtle"
              onClick={() => { const r = plusDays(n); setRecall(r); setStatus("rappeler"); save({ recall_at: r, call_status: "rappeler" }); }}>
              {l}
            </Button>
          ))}
        </div>
      </div>
      <Caption1 style={{ display: "block", margin: "10px 0 4px" }}>Note</Caption1>
      <Textarea value={note} onChange={(_, d) => setNote(d.value)} onBlur={() => save()} resize="vertical"
        placeholder="Ce qui a été dit, le bon interlocuteur, l'environnement (serveurs, fin de maintenance…)" style={{ width: "100%" }} />
      {(saving || saved) && <Caption1 style={{ display: "block", marginTop: 4, color: GREEN }}>{saving ? "Enregistrement…" : "Enregistré"}</Caption1>}
    </Card>
  );
}

/* ── Qui appeler ───────────────────────────────────────────────────────── */

function PersonRow({ p, accountName, primary, onDeleted, onError }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: primary ? "var(--colorBrandBackground2)" : "var(--colorNeutralBackground3)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Body1 style={{ fontWeight: 700 }}>{p.name}</Body1>
        {primary && <Badge appearance="filled" color="brand" size="small">à appeler en premier</Badge>}
        <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{p.role || "poste à confirmer"}</Caption1>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
        {p.phone && <CallButton number={p.phone} who={`${p.name} — ${accountName}`} />}
        {p.email && <Button as="a" size="small" icon={<Mail24Regular />} href={`mailto:${p.email}`}>{p.email}</Button>}
        <Button as="a" size="small" appearance="subtle" icon={<LinkSquare24Regular />} target="_blank" rel="noreferrer"
          href={p.linkedin || linkedinSearch(p.name, accountName)}>
          {p.linkedin ? "LinkedIn" : "Chercher sur LinkedIn"}
        </Button>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginLeft: "auto" }}>{p.source}</Caption1>
        {p.id && (
          <Button size="small" appearance="subtle" icon={<Delete24Regular />} aria-label={`Retirer ${p.name}`} title="Retirer ce contact"
            onClick={async () => {
              if (!confirm(`Retirer ${p.name} des contacts du compte ?`)) return;
              const r = await fetchJson(`/api/account-contacts/${p.id}`, { method: "DELETE" });
              if (!r.ok) { onError(r.error); return; }
              onDeleted();
            }} />
        )}
      </div>
    </div>
  );
}

// Standard : toujours présent. Numéro connu → un bouton d'appel ; sinon la
// recherche du numéro en un clic et un champ pour le coller (il passe alors
// devant tous les numéros trouvés automatiquement).
function StandardRow({ account, standard, searchUrl, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (v) => {
    setSaving(true);
    const r = await fetchJson(`/api/accounts/${account.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ standard_phone: v }),
    });
    setSaving(false);
    if (!r.ok) { onError(r.error); return; }
    setEditing(false); setValue(""); onSaved();
  };
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px dashed var(--colorNeutralStroke1)", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Body1 style={{ fontWeight: 700 }}>Standard</Body1>
        {standard ? (
          <>
            <CallButton number={standard.number} who={`Standard — ${account.name}`} />
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{standard.source}</Caption1>
          </>
        ) : (
          <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>numéro pas encore trouvé</Caption1>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {!standard && (
            <Button as="a" size="small" appearance="outline" icon={<Search24Regular />} href={searchUrl} target="_blank" rel="noreferrer">
              Trouver le numéro
            </Button>
          )}
          {!standard && <ZoomInfoButton name={account.health_detail?.sirene_name || account.name} />}
          <Button size="small" appearance="subtle" onClick={() => setEditing((v) => !v)}>
            {standard ? "Corriger" : "Saisir"}
          </Button>
        </div>
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Input type="tel" inputMode="tel" placeholder="02 41 00 00 00" value={value} onChange={(_, d) => setValue(d.value)} style={{ minWidth: 180 }} />
          <Button size="small" appearance="primary" disabled={saving || !value.trim()} onClick={() => save(value)}>Enregistrer</Button>
          {account.standard_source === "manuel" && (
            <Button size="small" appearance="subtle" disabled={saving} onClick={() => save("")}>Effacer mon numéro</Button>
          )}
        </div>
      )}
      <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
        Au standard : « Qui s'occupe de l'informatique chez vous, en interne ou un prestataire ? »
      </Caption1>
    </div>
  );
}

// Email à utiliser pour ce lead (celui que reçoit l'agent Sales Chat), avec sa
// confiance ; corrigeable à la main (la saisie passe devant le reste).
const CONF_COLOR = { "sûr": GREEN, probable: "#8A6A00", "supposé": "var(--colorNeutralForeground3)" };

function EmailRow({ account, email, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (v) => {
    setSaving(true);
    const r = await fetchJson(`/api/accounts/${account.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ found_email: v }),
    });
    setSaving(false);
    if (!r.ok) { onError(r.error); return; }
    setEditing(false); setValue(""); onSaved();
  };
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px dashed var(--colorNeutralStroke1)", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Body1 style={{ fontWeight: 700 }}>Email</Body1>
        {account.email_opt_out ? (
          <>
            <Badge appearance="tint" color="danger">ne plus écrire (STOP)</Badge>
            <Button size="small" appearance="subtle" disabled={saving} onClick={async () => {
              setSaving(true);
              const r = await fetchJson(`/api/accounts/${account.id}`, {
                method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ email_opt_out: false }),
              });
              setSaving(false);
              if (!r.ok) { onError(r.error); return; }
              onSaved();
            }}>Annuler le STOP</Button>
          </>
        ) : email ? (
          <>
            <Button as="a" size="small" icon={<Mail24Regular />} href={`mailto:${email.email}`} style={{ wordBreak: "break-all" }}>{email.email}</Button>
            <Caption1 style={{ color: CONF_COLOR[email.confidence] }}>{email.confidence}</Caption1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{email.source}</Caption1>
          </>
        ) : (
          <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>pas encore trouvé (recherche en cours)</Caption1>
        )}
        <Button size="small" appearance="subtle" style={{ marginLeft: "auto" }} onClick={() => setEditing((v) => !v)}>
          {email ? "Corriger" : "Saisir"}
        </Button>
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Input type="email" placeholder="prenom.nom@societe.fr" value={value} onChange={(_, d) => setValue(d.value)} style={{ minWidth: 220 }} />
          <Button size="small" appearance="primary" disabled={saving || !value.trim()} onClick={() => save(value)}>Enregistrer</Button>
          {account.found_email_source === "manuel" && (
            <Button size="small" appearance="subtle" disabled={saving} onClick={() => save("")}>Effacer mon email</Button>
          )}
        </div>
      )}
    </div>
  );
}

function PeopleCard({ account, contacts, onChange, onError }) {
  const prep = account.call_prep;
  const who = whoToCall({ account, contacts });
  const email = pickEmail({ account, contacts });
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <People24Regular style={{ color: BRAND }} />
        <Body1 style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Qui appeler</Body1>
        <AddContactForm accountId={account.id} onAdded={onChange} onError={onError} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {who.people.slice(0, 5).map((p, i) => (
          <PersonRow key={p.id || p.name} p={p} accountName={account.name} primary={i === 0} onDeleted={onChange} onError={onError} />
        ))}
        {who.people.length === 0 && (
          <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground2)", lineHeight: 1.6 }}>
            Personne de nommé pour l'instant (la recherche tourne en arrière-plan) : appelle le standard et demande
            le responsable informatique.
          </Caption1>
        )}
        <StandardRow account={account} standard={who.standard} searchUrl={who.phone_search_url} onSaved={onChange} onError={onError} />
        <EmailRow account={account} email={email} onSaved={onChange} onError={onError} />
      </div>
      {prep?.postes_a_chercher?.length > 0 && (
        <Caption1 style={{ display: "block", marginTop: 10, color: "var(--colorNeutralForeground2)" }}>
          Postes à viser : {prep.postes_a_chercher.join(" · ")}
        </Caption1>
      )}
      {prep?.it_externalisee && (
        <Caption1 style={{ display: "block", marginTop: 4, color: "var(--colorNeutralForeground2)" }}>{prep.it_externalisee}</Caption1>
      )}
    </Card>
  );
}

function AddContactForm({ accountId, onAdded, onError }) {
  const empty = { first_name: "", last_name: "", role: "", phone: "", email: "", linkedin_url: "" };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(empty);
  if (!open) {
    return <Button size="small" appearance="outline" icon={<PersonAdd24Regular />} onClick={() => setOpen(true)}>Ajouter un contact</Button>;
  }
  const field = (k, label, ph) => (
    <div>
      <Caption1 style={{ display: "block", marginBottom: 4 }}>{label}</Caption1>
      <Input value={f[k]} placeholder={ph} onChange={(_, d) => setF({ ...f, [k]: d.value })} style={{ width: "100%" }} />
    </div>
  );
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {field("first_name", "Prénom")}
        {field("last_name", "Nom")}
        {field("role", "Poste", "Responsable informatique")}
        {field("phone", "Téléphone")}
        {field("email", "Email")}
        {field("linkedin_url", "LinkedIn", "https://www.linkedin.com/in/…")}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button appearance="primary" onClick={async () => {
          if (!f.first_name && !f.last_name) return;
          const r = await fetchJson("/api/account-contacts", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account_id: accountId, ...f }),
          });
          if (!r.ok) { onError(r.error); return; }
          setF(empty); setOpen(false); onAdded();
        }}>Ajouter</Button>
        <Button appearance="outline" onClick={() => setOpen(false)}>Annuler</Button>
      </div>
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function AccountClient({ id, initialData = null }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const load = async () => {
    const { ok, data: d, error: err } = await fetchJson(`/api/accounts/${id}`, { cache: "no-store" });
    if (!ok) { setError(err); return; }
    setData(d);
  };

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
        {error ? <Body1 style={{ color: RED }}>{error}</Body1>
          : <><Spinner size="small" /><Body1 style={{ color: "var(--colorNeutralForeground2)" }}>Chargement…</Body1></>}
      </div>
    );
  }

  const { account, contacts } = data;
  const d = account.health_detail || {};
  const meta = HEALTH_META[account.health_status] || null;
  const coord = account.call_prep?.coordonnees || {};
  const who = whoToCall({ account, contacts: contacts || [] });
  const standard = who.standard?.number || "";
  const site = coord.site || account.web_intel?.site?.url || account.website || "";
  const status = CALL_STATUS_META[account.call_status];
  const successorName = d.successor?.confidence === "forte" ? d.successor.name : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── En-tête : l'essentiel en un coup d'œil ── */}
      <div>
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/leads"))}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "var(--colorNeutralForeground3)", fontSize: 13, padding: "0 0 10px", marginLeft: -4 }}
        >
          <ArrowLeft24Regular style={{ fontSize: 16 }} /> Leads
        </button>
        <Title2>{successorName || account.name}</Title2>
        {successorName && <Caption1 style={{ display: "block", color: "var(--colorNeutralForeground3)" }}>Nom Salesforce : {account.name}</Caption1>}
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          {meta && <Badge appearance="filled" color={meta.color}>{meta.label}</Badge>}
          {status && <Badge appearance="tint" color={status.color}>{status.label}</Badge>}
          {account.recall_at && <Badge appearance="tint" color="important">Rappel : {new Date(account.recall_at).toLocaleDateString("fr-FR")}</Badge>}
          {account.sf_lead_status && <Badge appearance="outline">Salesforce : {sfStatusLabel(account.sf_lead_status)}</Badge>}
          {d.commune && <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{d.commune}</Caption1>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {who.people[0]?.phone && (
            <CallButton size="medium" number={who.people[0].phone} label={`${who.people[0].name} · ${who.people[0].phone}`}
              who={`${who.people[0].name} — ${account.name}`} />
          )}
          {standard ? (
            <CallButton size="medium" appearance={who.people[0]?.phone ? "outline" : "primary"} number={standard}
              label={`Standard ${standard}`} who={`Standard — ${account.name}`} />
          ) : (
            <Button as="a" appearance="outline" icon={<Search24Regular />} href={who.phone_search_url} target="_blank" rel="noreferrer">
              Trouver le standard
            </Button>
          )}
          {site && <Button as="a" icon={<Globe24Regular />} href={site} target="_blank" rel="noreferrer">Site web</Button>}
          {coord.email_generique && <Button as="a" icon={<Mail24Regular />} href={`mailto:${coord.email_generique}`}>{coord.email_generique}</Button>}
        </div>
      </div>

      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 role="alert" style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── Brief : verdict, anomalies, question, note Salesforce ── */}
      <BriefCard account={account} brief={data.brief} onDone={load} onError={setError} />

      <div className="lead-cols">
        <div className="lead-col">
          {/* ── Qui appeler ── */}
          <div className="o1"><PeopleCard account={account} contacts={contacts || []} onChange={load} onError={setError} /></div>
          {/* ── Suivi d'appel ── */}
          <div className="o3"><CallTracker account={account} onSaved={load} onError={setError} /></div>
        </div>
        <div className="lead-col">
          {/* ── Accroche et messages ── */}
          <div className="o2">
            <CallPrepCard accountId={id} accountName={account.name} contacts={contacts || []} prep={account.call_prep}
              generatedAt={account.call_prep_at} onDone={load} onError={setError} />
          </div>
          {/* ── Existe-t-elle encore ? ── */}
          <div className="o4"><HealthCard account={account} onDone={load} onError={setError} /></div>
        </div>
      </div>

      {/* ── Détails (infos publiques collectées) ── */}
      <div>
        <Button appearance="subtle" icon={showDetails ? <ChevronUp24Regular /> : <ChevronDown24Regular />}
          onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "Masquer les infos publiques" : "Infos publiques (site, emails, outils, marchés publics…)"}
        </Button>
        {showDetails && <div style={{ marginTop: 8 }}><IntelCard account={account} onDone={load} onError={setError} /></div>}
      </div>

      <div style={{ borderTop: "1px solid var(--colorNeutralStroke2)", paddingTop: 12 }}>
        <Button appearance="subtle" icon={<Delete24Regular />} style={{ color: RED }}
          onClick={async () => {
            if (!confirm("Supprimer ce compte et ses contacts ?")) return;
            const r = await fetchJson(`/api/accounts/${id}`, { method: "DELETE" });
            if (!r.ok) { setError(r.error); return; }
            router.push("/leads");
          }}>
          Supprimer le compte
        </Button>
      </div>
    </div>
  );
}
