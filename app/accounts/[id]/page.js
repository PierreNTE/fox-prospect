"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  Button,
  Input,
  Select,
  Title2,
  Body1,
  Caption1,
  Badge,
  Spinner,
  Switch,
} from "@fluentui/react-components";
import {
  ArrowClockwise24Regular,
  PersonAdd24Regular,
  Checkmark24Regular,
  Edit24Regular,
  Delete24Regular,
  Globe24Regular,
  Mail24Regular,
  Phone24Regular,
  LinkSquare24Regular,
  Building24Regular,
  News24Regular,
  People24Regular,
  ArrowLeft24Regular,
  Search24Regular,
  Sparkle24Regular,
} from "@fluentui/react-icons";
import { NEWS_CATEGORY_LABELS } from "@/lib/constants";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const RED = "#C50F1F";
const AMBER = "#F6A623";
const BLUE = "#0078D4";

// Couleur par catégorie d'actualité (discrète, lisible en clair/sombre).
const CATEGORY_COLOR = {
  nomination: BRAND,
  fusion_acquisition: "#8B5CF6",
  investissement: GREEN,
  recrutement: BLUE,
  projet: BRAND,
  transformation: "#0EA5E9",
  cloud: "#0EA5E9",
  ia: "#8B5CF6",
  cybersecurite: RED,
  erp_crm: "#E8730C",
  infrastructure: "#64748B",
  data: "#0891B2",
  resultats: GREEN,
};

// Niveau hiérarchique : couleur d'accent pour lire l'organigramme d'un coup d'œil.
const LEVEL_META = {
  direction: { color: BRAND, label: "Direction" },
  management: { color: BLUE, label: "Management" },
  operationnel: { color: "#64748B", label: "Opérationnel" },
};

const RELIABILITY = {
  verifie: { label: "Vérifié", color: GREEN },
  partiel: { label: "Partiel", color: AMBER },
  non_verifie: { label: "À confirmer", color: "var(--colorNeutralForeground3)" },
};

// Une coordonnée est « exploitable » dans l'ordre de priorité produit :
// email pro > LinkedIn > téléphone.
function bestChannel(c) {
  if ((c.email || "").trim()) return "email";
  if ((c.linkedin_url || "").trim()) return "linkedin";
  if ((c.phone || "").trim()) return "phone";
  return null;
}

function initials(c) {
  const a = (c.first_name || "").trim()[0] || "";
  const b = (c.last_name || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}

/* ── Petits éléments ── */

function RelDot({ value }) {
  const r = RELIABILITY[value] || RELIABILITY.non_verifie;
  return (
    <span title={`Fiabilité : ${r.label}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: r.color, fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: r.color }} />
      {r.label}
    </span>
  );
}

function CategoryChip({ category }) {
  const color = CATEGORY_COLOR[category] || "var(--colorNeutralForeground3)";
  const label = NEWS_CATEGORY_LABELS[category] || category;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color, whiteSpace: "nowrap",
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      borderRadius: 6, padding: "2px 8px",
    }}>
      {label}
    </span>
  );
}

// Actualité : chip catégorie + titre + date + source cliquable.
function NewsCard({ n }) {
  const link = n.url || (/^https?:\/\//i.test(n.source) ? n.source : "");
  let domain = "";
  try { domain = link ? new URL(link).hostname.replace(/^www\./, "") : n.source; } catch { domain = n.source; }
  return (
    <div style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <CategoryChip category={n.category} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Body1 style={{ fontWeight: 600, display: "block" }}>
          {n.title || n.detail}
        </Body1>
        {n.title && n.detail && (
          <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 2 }}>{n.detail}</Caption1>
        )}
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>
          {n.date}
          {domain && (
            <>
              {" · "}
              {link ? (
                <a href={link} target="_blank" rel="noreferrer" style={{ color: BRAND, textDecoration: "none" }}>{domain} ↗</a>
              ) : domain}
            </>
          )}
        </Caption1>
      </div>
    </div>
  );
}

// Rangée de coordonnées d'un contact (icônes actionnables, ordre de priorité).
function ContactChannels({ c, onEnrich, enriching }) {
  const email = (c.email || "").trim();
  const linkedin = (c.linkedin_url || "").trim();
  const phone = (c.phone || "").trim();
  const has = email || linkedin || phone;

  if (!has) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>Aucune coordonnée</span>
        <Button appearance="outline" size="small" icon={enriching ? <Spinner size="tiny" /> : <Search24Regular />}
          disabled={enriching} onClick={onEnrich}>
          {enriching ? "Recherche…" : "Enrichir"}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
      {email && (
        <a href={`mailto:${email}`} onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, color: BRAND, textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
          <Mail24Regular style={{ fontSize: 15 }} /> {email}
        </a>
      )}
      {linkedin && (
        <a href={linkedin} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#0077b5", textDecoration: "none", fontSize: 13 }}>
          <LinkSquare24Regular style={{ fontSize: 15 }} /> LinkedIn ↗
        </a>
      )}
      {phone && (
        <a href={`tel:${phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, color: GREEN, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
          <Phone24Regular style={{ fontSize: 15 }} /> {phone}
        </a>
      )}
      {!email && (
        <Button appearance="subtle" size="small" icon={enriching ? <Spinner size="tiny" /> : <Search24Regular />}
          disabled={enriching} onClick={onEnrich} title="Compléter les coordonnées">
          {enriching ? "…" : "Compléter"}
        </Button>
      )}
    </div>
  );
}

/* ── Carte contact (nœud d'organigramme) ── */

function ContactCard({ contact, contacts, account, existingProspectKeys, onChange, onConverted }) {
  const [editing, setEditing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [converting, setConverting] = useState(false);
  const [f, setF] = useState(contact);

  const lvl = LEVEL_META[contact.level];

  // Déjà transformé en prospect ? (même prénom|nom|entreprise que la liste active)
  const personKey = `${contact.first_name || ""}|${contact.last_name || ""}|${account?.name || ""}`.toLowerCase();
  const alreadyProspect = existingProspectKeys?.has(personKey);

  // Étape « Création du prospect » du tunnel : bascule un décideur de
  // l'organigramme vers la piste commerciale (réutilise la dédup de l'API).
  const convert = async () => {
    setConverting(true);
    try {
      await fetch("/api/prospects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: contact.first_name,
          last_name: contact.last_name,
          role: contact.role,
          company: account?.name || "",
          company_website: account?.website || "",
          email: contact.email || "",
          linkedin_url: contact.linkedin_url || "",
        }),
      });
      onConverted && onConverted();
    } finally { setConverting(false); }
  };

  const save = async () => {
    await fetch(`/api/account-contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: f.first_name, last_name: f.last_name, role: f.role,
        department: f.department, level: f.level,
        email: f.email, phone: f.phone, linkedin_url: f.linkedin_url,
        reliability: f.reliability, manager_id: f.manager_id || null,
      }),
    });
    setEditing(false);
    onChange();
  };

  const validate = async () => {
    await fetch(`/api/account-contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ validated: true, reliability: "verifie" }),
    });
    onChange();
  };

  const remove = async () => {
    if (!confirm("Retirer cette personne de l'organigramme ?")) return;
    await fetch(`/api/account-contacts/${contact.id}`, { method: "DELETE" });
    onChange();
  };

  const enrich = async () => {
    setEnriching(true);
    try {
      await fetch(`/api/account-contacts/${contact.id}/enrich`, { method: "POST" });
      onChange();
    } finally { setEnriching(false); }
  };

  if (editing) {
    return (
      <Card style={{ padding: 16, borderLeft: `3px solid ${BRAND}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Prénom</Caption1>
            <Input value={f.first_name || ""} onChange={(_, d) => setF({ ...f, first_name: d.value })} />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Nom</Caption1>
            <Input value={f.last_name || ""} onChange={(_, d) => setF({ ...f, last_name: d.value })} />
          </div>
        </div>
        <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Fonction</Caption1>
        <Input value={f.role || ""} onChange={(_, d) => setF({ ...f, role: d.value })} style={{ marginBottom: 10 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Service</Caption1>
            <Input value={f.department || ""} onChange={(_, d) => setF({ ...f, department: d.value })} placeholder="DSI, Finance…" />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Niveau</Caption1>
            <Select value={f.level || ""} onChange={(_, d) => setF({ ...f, level: d.value })}>
              <option value="">—</option>
              <option value="direction">Direction</option>
              <option value="management">Management</option>
              <option value="operationnel">Opérationnel</option>
            </Select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Email</Caption1>
            <Input value={f.email || ""} onChange={(_, d) => setF({ ...f, email: d.value })} />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Téléphone</Caption1>
            <Input value={f.phone || ""} onChange={(_, d) => setF({ ...f, phone: d.value })} />
          </div>
        </div>
        <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>LinkedIn</Caption1>
        <Input value={f.linkedin_url || ""} onChange={(_, d) => setF({ ...f, linkedin_url: d.value })} style={{ marginBottom: 10 }} />
        <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Responsable (manager)</Caption1>
        <Select value={f.manager_id || ""} onChange={(_, d) => setF({ ...f, manager_id: d.value })} style={{ marginBottom: 14 }}>
          <option value="">— aucun —</option>
          {contacts.filter((c) => c.id !== contact.id).map((c) => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
          ))}
        </Select>
        <div style={{ display: "flex", gap: 8 }}>
          <Button appearance="primary" onClick={save}>Enregistrer</Button>
          <Button appearance="outline" onClick={() => { setF(contact); setEditing(false); }}>Annuler</Button>
        </div>
      </Card>
    );
  }

  const accent = lvl?.color || "var(--colorNeutralStroke1)";

  return (
    <Card style={{ padding: "14px 16px", borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Avatar initiales */}
        <div style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `color-mix(in srgb, ${accent} 16%, transparent)`,
          color: accent, fontWeight: 800, fontSize: 14,
        }}>
          {initials(contact)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Body1 style={{ fontWeight: 700 }}>{contact.first_name} {contact.last_name}</Body1>
            {lvl && (
              <span style={{ fontSize: 10, fontWeight: 700, color: lvl.color, border: `1px solid ${lvl.color}`, borderRadius: 4, padding: "0 6px" }}>
                {lvl.label}
              </span>
            )}
            {!contact.validated && <Badge appearance="tint" color="warning" size="small">proposé</Badge>}
          </div>
          {contact.role && (
            <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 1 }}>
              {contact.role}{contact.department ? ` · ${contact.department}` : ""}
            </Caption1>
          )}
          <div style={{ marginTop: 6 }}><RelDot value={contact.reliability} /></div>
          <ContactChannels c={contact} onEnrich={enrich} enriching={enriching} />
          {/* Étape tunnel : créer le prospect à partir du décideur */}
          <div style={{ marginTop: 10 }}>
            {alreadyProspect ? (
              <Caption1 style={{ color: GREEN, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Checkmark24Regular style={{ fontSize: 14 }} /> Déjà sur la piste
              </Caption1>
            ) : (
              <Button appearance="primary" size="small" icon={converting ? <Spinner size="tiny" /> : <PersonAdd24Regular />}
                disabled={converting} onClick={convert}>
                {converting ? "Création…" : "Créer un prospect"}
              </Button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {!contact.validated && (
            <Button appearance="subtle" size="small" icon={<Checkmark24Regular />} onClick={validate} title="Valider" />
          )}
          <Button appearance="subtle" size="small" icon={<Edit24Regular />} onClick={() => setEditing(true)} title="Éditer" />
          <Button appearance="subtle" size="small" icon={<Delete24Regular />} onClick={remove} title="Retirer" />
        </div>
      </div>
    </Card>
  );
}

function OrgNode({ contact, childrenOf, contacts, account, existingProspectKeys, onChange, onConverted }) {
  const kids = childrenOf(contact.id);
  return (
    <div>
      <ContactCard contact={contact} contacts={contacts} account={account}
        existingProspectKeys={existingProspectKeys} onChange={onChange} onConverted={onConverted} />
      {kids.length > 0 && (
        <div style={{ paddingLeft: 24, borderLeft: "2px solid var(--colorNeutralStroke2)", marginLeft: 20, marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {kids.map((k) => (
            <OrgNode key={k.id} contact={k} childrenOf={childrenOf} contacts={contacts} account={account}
              existingProspectKeys={existingProspectKeys} onChange={onChange} onConverted={onConverted} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgTree({ contacts, account, existingProspectKeys, onChange, onConverted }) {
  const childrenOf = (mid) => contacts.filter((c) => c.manager_id === mid);
  const ids = new Set(contacts.map((c) => c.id));
  // Racines : personnes sans manager (ou manager hors-liste). Triées Direction d'abord.
  const rank = { direction: 0, management: 1, operationnel: 2, "": 3 };
  const roots = contacts
    .filter((c) => !c.manager_id || !ids.has(c.manager_id))
    .sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {roots.map((c) => (
        <OrgNode key={c.id} contact={c} childrenOf={childrenOf} contacts={contacts} account={account}
          existingProspectKeys={existingProspectKeys} onChange={onChange} onConverted={onConverted} />
      ))}
    </div>
  );
}

function AddContact({ accountId, contacts, onAdded }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ first_name: "", last_name: "", role: "", department: "", level: "", manager_id: "" });

  if (!open) {
    return (
      <Button appearance="outline" size="small" icon={<PersonAdd24Regular />} onClick={() => setOpen(true)}>
        Ajouter une personne
      </Button>
    );
  }

  return (
    <Card style={{ padding: 16, borderLeft: `3px solid ${BRAND}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Prénom</Caption1>
          <Input value={f.first_name} onChange={(_, d) => setF({ ...f, first_name: d.value })} />
        </div>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Nom</Caption1>
          <Input value={f.last_name} onChange={(_, d) => setF({ ...f, last_name: d.value })} />
        </div>
      </div>
      <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Fonction</Caption1>
      <Input value={f.role} onChange={(_, d) => setF({ ...f, role: d.value })} style={{ marginBottom: 10 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Service</Caption1>
          <Input value={f.department} onChange={(_, d) => setF({ ...f, department: d.value })} placeholder="DSI, Finance…" />
        </div>
        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Niveau</Caption1>
          <Select value={f.level} onChange={(_, d) => setF({ ...f, level: d.value })}>
            <option value="">—</option>
            <option value="direction">Direction</option>
            <option value="management">Management</option>
            <option value="operationnel">Opérationnel</option>
          </Select>
        </div>
      </div>
      <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Responsable</Caption1>
      <Select value={f.manager_id} onChange={(_, d) => setF({ ...f, manager_id: d.value })} style={{ marginBottom: 14 }}>
        <option value="">— aucun —</option>
        {contacts.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
      </Select>
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          appearance="primary"
          onClick={async () => {
            if (!f.first_name && !f.last_name) return;
            await fetch("/api/account-contacts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ account_id: accountId, ...f, manager_id: f.manager_id || null }),
            });
            setF({ first_name: "", last_name: "", role: "", department: "", level: "", manager_id: "" });
            setOpen(false);
            onAdded();
          }}
        >
          Ajouter
        </Button>
        <Button appearance="outline" onClick={() => setOpen(false)}>Annuler</Button>
      </div>
    </Card>
  );
}

// Bandeau de joignabilité : combien de personnes ont une coordonnée exploitable.
function ReachSummary({ contacts, onEnrichAll, enrichingAll }) {
  const total = contacts.length;
  const reachable = contacts.filter((c) => bestChannel(c)).length;
  const missing = total - reachable;
  const allReachable = total > 0 && missing === 0;
  return (
    <Card style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 32, height: 32, borderRadius: "50%",
        background: `color-mix(in srgb, ${allReachable ? GREEN : missing ? AMBER : RED} 16%, transparent)`,
        color: allReachable ? GREEN : missing ? AMBER : RED,
      }}>
        {allReachable ? <Checkmark24Regular /> : <Mail24Regular />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Body1 style={{ fontWeight: 700 }}>
          {reachable}/{total} contact{total > 1 ? "s" : ""} joignable{reachable > 1 ? "s" : ""}
        </Body1>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          {allReachable
            ? "Tous les décideurs ont au moins une coordonnée."
            : missing
              ? `${missing} personne(s) sans coordonnée — enrichis pour les rendre joignables.`
              : "Aucun contact cartographié pour l'instant."}
        </Caption1>
      </div>
      {missing > 0 && (
        <Button appearance="primary" size="small" icon={enrichingAll ? <Spinner size="tiny" /> : <Sparkle24Regular />}
          disabled={enrichingAll} onClick={onEnrichAll}>
          {enrichingAll ? "Enrichissement…" : `Enrichir les ${missing} manquant(s)`}
        </Button>
      )}
    </Card>
  );
}

/* ── Page ── */

export default function AccountPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [enrichingAll, setEnrichingAll] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/accounts/${id}`);
    const d = await res.json();
    if (d.error) setError(d.error);
    else setData(d);
  };
  useEffect(() => { load(); }, [id]);

  const analyze = async () => {
    setBusy("analyze"); setError("");
    try {
      const res = await fetch("/api/accounts/analyze", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) setError(d.error || `Erreur ${res.status}.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const deduceOrg = async () => {
    setBusy("org"); setError("");
    try {
      const res = await fetch(`/api/accounts/${id}/org-structure`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) setError(d.error || `Erreur ${res.status}.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const toggleWatch = async () => {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto_watch: !data.account.auto_watch }),
    });
    load();
  };

  // Enrichit en série toutes les personnes sans coordonnée exploitable.
  const enrichAll = async () => {
    setEnrichingAll(true);
    try {
      const missing = (data.contacts || []).filter((c) => !bestChannel(c));
      for (const c of missing) {
        await fetch(`/api/account-contacts/${c.id}/enrich`, { method: "POST" }).catch(() => {});
        await load();
      }
    } finally { setEnrichingAll(false); }
  };

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
        {error ? (
          <Body1 style={{ color: RED }}>{error}</Body1>
        ) : (
          <><Spinner size="small" /><Body1 style={{ color: "var(--colorNeutralForeground2)" }}>Chargement…</Body1></>
        )}
      </div>
    );
  }

  const { account, contacts, prospects } = data;
  const news = (account.news || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const analyzed = !!account.last_refreshed_at;
  // Clés des personnes déjà sur la piste (pour masquer « Créer un prospect »).
  const prospectKeys = new Set(
    (prospects || []).map((p) => `${p.first_name || ""}|${p.last_name || ""}|${account.name || ""}`.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Header ── */}
      <div>
        <button
          onClick={() => router.push("/accounts")}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "var(--colorNeutralForeground3)", fontSize: 13, padding: "0 0 12px", marginLeft: -4 }}
        >
          <ArrowLeft24Regular style={{ fontSize: 16 }} /> Comptes
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <Title2>{account.name}</Title2>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              {account.sector && <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{account.sector}</Caption1>}
              {account.hq && <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>· {account.hq}</Caption1>}
              {account.website && (
                <a href={account.website} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 4, color: BRAND, textDecoration: "none", fontSize: 13 }}>
                  <Globe24Regular style={{ fontSize: 15 }} />Site ↗
                </a>
              )}
            </div>
          </div>
          <Button
            appearance="primary"
            icon={busy === "analyze" ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />}
            disabled={!!busy}
            onClick={analyze}
          >
            {analyzed ? "Rafraîchir" : "Analyser le compte"}
          </Button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
          {analyzed && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Dernière analyse : {new Date(account.last_refreshed_at).toLocaleDateString("fr-FR")}
            </Caption1>
          )}
          <Switch checked={!!account.auto_watch} onChange={toggleWatch} label="Veille automatique" />
        </div>
        {busy === "analyze" && (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 6 }}>
            Recherche web en cours, 30–90 secondes…
          </Caption1>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── Pas encore analysé ── */}
      {!analyzed && !busy && (
        <Card style={{ padding: "36px 24px", textAlign: "center" }}>
          <Building24Regular style={{ fontSize: 40, color: "var(--colorNeutralForeground3)", display: "block", margin: "0 auto 12px" }} />
          <Body1 style={{ color: "var(--colorNeutralForeground1)", fontWeight: 600, display: "block", marginBottom: 4 }}>
            Comprends ce compte en 30 secondes
          </Body1>
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>
            Lance l'analyse : actualités récentes, organigramme des décideurs et coordonnées.
          </Body1>
        </Card>
      )}

      {/* ── Synthèse ── */}
      {account.summary && (
        <Card style={{ padding: "18px 20px", borderLeft: `3px solid ${BRAND}` }}>
          <Body1 style={{ color: "var(--colorNeutralForeground1)", lineHeight: 1.6 }}>{account.summary}</Body1>
        </Card>
      )}

      {/* ── 1. Actualités ── */}
      {analyzed && (
        <Card style={{ padding: "20px 20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <News24Regular style={{ color: BRAND }} />
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Actualités</Body1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>12 derniers mois · impact métier / IT</Caption1>
          </div>
          {news.length === 0 ? (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 8 }}>
              Aucune actualité marquante identifiée sur les 12 derniers mois.
            </Caption1>
          ) : (
            <div style={{ marginTop: 4 }}>
              {news.map((n, i) => <NewsCard key={i} n={n} />)}
            </div>
          )}
        </Card>
      )}

      {/* ── 2. Organigramme ── */}
      {analyzed && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <People24Regular style={{ color: BRAND }} />
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Organigramme</Body1>
              {contacts.length > 0 && <Badge appearance="outline">{contacts.length}</Badge>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {contacts.length >= 2 && (
                <Button appearance="subtle" size="small" disabled={!!busy} onClick={deduceOrg}
                  icon={busy === "org" ? <Spinner size="tiny" /> : <People24Regular />}>
                  Déduire la hiérarchie
                </Button>
              )}
              <AddContact accountId={id} contacts={contacts} onAdded={load} />
            </div>
          </div>
          {contacts.length === 0 ? (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Aucune personne cartographiée. L'analyse propose les décideurs identifiables publiquement, ou ajoute-les manuellement.
            </Caption1>
          ) : (
            <>
              <ReachSummary contacts={contacts} onEnrichAll={enrichAll} enrichingAll={enrichingAll} />
              <div style={{ marginTop: 14 }}>
                <OrgTree contacts={contacts} account={account} existingProspectKeys={prospectKeys}
                  onChange={load} onConverted={load} />
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── Prospects en cours ── */}
      {prospects.length > 0 && (
        <Card style={{ padding: "20px 20px 22px" }}>
          <Body1 style={{ fontWeight: 700, fontSize: 15, display: "block", marginBottom: 12 }}>Prospects en cours</Body1>
          {prospects.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/prospects/${p.id}`)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--colorNeutralStroke2)", cursor: "pointer" }}
            >
              <Body1 style={{ fontWeight: 600 }}>
                {p.first_name} {p.last_name}
                <span style={{ fontWeight: 400, color: "var(--colorNeutralForeground3)" }}> — {p.role || "poste inconnu"}</span>
              </Body1>
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{p.status}</Caption1>
            </div>
          ))}
        </Card>
      )}

      {/* ── Danger zone ── */}
      <div style={{ borderTop: "1px solid var(--colorNeutralStroke2)", paddingTop: 16 }}>
        <Button
          appearance="subtle"
          icon={<Delete24Regular />}
          style={{ color: RED }}
          onClick={async () => {
            if (!confirm("Supprimer ce compte et son organigramme ?")) return;
            await fetch(`/api/accounts/${id}`, { method: "DELETE" });
            router.push("/accounts");
          }}
        >
          Supprimer le compte
        </Button>
      </div>
    </div>
  );
}
