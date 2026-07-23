"use client";

import { useState } from "react";
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
import Link from "next/link";
import { NEWS_CATEGORY_LABELS, statusLabel } from "@/lib/constants";
import { fetchJson } from "@/lib/fetch-json";
import DocumentsCard from "@/components/DocumentsCard";
import BudgetHint from "@/components/BudgetHint";

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

// ── FV4 — timeline au niveau compte ─────────────────────────────────────────
const TL_CHANNEL = { appel: "Appel", email: "E-mail", linkedin: "LinkedIn", autre: "Échange" };
function tlFmt(s) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(s); }
}
function tlLine(ev) {
  switch (ev.kind) {
    case "interaction": return { label: TL_CHANNEL[ev.channel] || "Échange", detail: ev.note || ev.next_action || "", color: BRAND };
    case "status_change": return { label: "Changement de statut", detail: `${statusLabel(ev.from_status)} → ${statusLabel(ev.to_status)}`, color: "var(--colorNeutralForeground3)" };
    case "research_done": return { label: "Recherche IA", detail: "Qualification", color: BRAND };
    case "draft_generated": return { label: "Brouillons générés", detail: "", color: "#8B5CF6" };
    case "enrich_done": return { label: "Enrichissement", detail: ev.note || "", color: "#8B5CF6" };
    case "opt_out": return { label: "Ne pas contacter", detail: ev.note || "", color: RED };
    default: return { label: ev.kind, detail: ev.note || "", color: "var(--colorNeutralForeground3)" };
  }
}

// Agrège l'activité de tous les contacts du compte : la mémoire du compte en un
// seul endroit, plutôt qu'éparpillée sur chaque fiche prospect.
function AccountTimeline({ events, prospectById }) {
  if (!events || events.length === 0) return null;
  return (
    <Card style={{ padding: "20px 20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Historique du compte</Body1>
        <Badge appearance="outline">{events.length}</Badge>
      </div>
      {events.map((ev) => {
        const l = tlLine(ev);
        const who = prospectById.get(ev.prospect_id);
        return (
          <div key={ev.id} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: "1px solid var(--colorNeutralStroke2)" }}>
            <span style={{ flexShrink: 0, marginTop: 6, width: 8, height: 8, borderRadius: "50%", background: l.color }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Body1 style={{ fontWeight: 600, fontSize: 13 }}>
                {l.label}
                {who && <span style={{ fontWeight: 400, color: "var(--colorNeutralForeground3)" }}> · {who}</span>}
              </Body1>
              {l.detail && <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block" }}>{l.detail}</Caption1>}
            </div>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", flexShrink: 0, whiteSpace: "nowrap", fontSize: 11 }}>{tlFmt(ev.occurred_at)}</Caption1>
          </div>
        );
      })}
    </Card>
  );
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

function ContactCard({ contact, contacts, account, prospectByKey, onChange, onConverted, onError }) {
  const [editing, setEditing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [converting, setConverting] = useState(false);
  const [createdId, setCreatedId] = useState(null);
  const [f, setF] = useState(contact);

  const lvl = LEVEL_META[contact.level];

  // Déjà transformé en prospect ? (même prénom|nom|entreprise que la liste active)
  const personKey = `${contact.first_name || ""}|${contact.last_name || ""}|${account?.name || ""}`.toLowerCase();
  const existingProspectId = createdId || prospectByKey?.get(personKey) || null;

  // Étape « Création du prospect » du tunnel : bascule un décideur de
  // l'organigramme vers les prospects (réutilise la dédup de l'API).
  const convert = async () => {
    setConverting(true);
    onError("");
    try {
      const { ok, status, data: d, error } = await fetchJson("/api/prospects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: contact.first_name,
          last_name: contact.last_name,
          role: contact.role,
          company: account?.name || "",
          company_website: account?.website || "",
          email: contact.email || "",
          phone: contact.phone || "",
          linkedin_url: contact.linkedin_url || "",
          account_id: account?.id || null,
        }),
      });

      if (ok && d?.created?.length) {
        setCreatedId(d.created[0].id);
        onConverted && onConverted();
        return;
      }

      // Doublon : la personne existe déjà côté prospects (ex. importée avant
      // la création du compte, donc sans account_id). On la rattache au compte
      // au lieu d'échouer en silence, et on propose d'ouvrir sa fiche.
      const dupId = d?.duplicate_ids?.[0];
      if (status === 400 && dupId) {
        const attach = await fetchJson(`/api/prospects/${dupId}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ account_id: account?.id || null }),
        });
        if (!attach.ok) { onError(attach.error); return; }
        setCreatedId(dupId);
        onConverted && onConverted();
        return;
      }

      if (!ok) onError(error);
    } finally { setConverting(false); }
  };

  const save = async () => {
    const { ok, error } = await fetchJson(`/api/account-contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: f.first_name, last_name: f.last_name, role: f.role,
        department: f.department, level: f.level,
        email: f.email, phone: f.phone, linkedin_url: f.linkedin_url,
        reliability: f.reliability, manager_id: f.manager_id || null,
      }),
    });
    if (!ok) { onError(error); return; }
    setEditing(false);
    onChange();
  };

  const validate = async () => {
    const { ok, error } = await fetchJson(`/api/account-contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ validated: true, reliability: "verifie" }),
    });
    if (!ok) { onError(error); return; }
    onChange();
  };

  const remove = async () => {
    if (!confirm("Retirer cette personne de l'organigramme ?")) return;
    const { ok, error } = await fetchJson(`/api/account-contacts/${contact.id}`, { method: "DELETE" });
    if (!ok) { onError(error); return; }
    onChange();
  };

  const enrich = async () => {
    setEnriching(true);
    onError("");
    try {
      const { ok, error } = await fetchJson(`/api/account-contacts/${contact.id}/enrich`, { method: "POST" });
      if (!ok) { onError(error); return; }
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
          {/* Étape tunnel : créer le prospect à partir du décideur.
              Sans aucune coordonnée, pas de bouton : un prospect injoignable
              ne sert à rien — enrichir d'abord. */}
          <div style={{ marginTop: 10 }}>
            {existingProspectId ? (
              <Link href={`/prospects/${existingProspectId}`}
                style={{ color: GREEN, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, textDecoration: "none" }}>
                <Checkmark24Regular style={{ fontSize: 14 }} /> Prospect créé — voir la fiche ↗
              </Link>
            ) : bestChannel(contact) ? (
              <Button appearance="primary" size="small" icon={converting ? <Spinner size="tiny" /> : <PersonAdd24Regular />}
                disabled={converting} onClick={convert}>
                {converting ? "Création…" : "Créer un prospect"}
              </Button>
            ) : (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                Enrichis une coordonnée avant de créer le prospect.
              </Caption1>
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

function OrgNode({ contact, childrenOf, contacts, account, prospectByKey, onChange, onConverted, onError }) {
  const kids = childrenOf(contact.id);
  return (
    <div>
      <ContactCard contact={contact} contacts={contacts} account={account}
        prospectByKey={prospectByKey} onChange={onChange} onConverted={onConverted} onError={onError} />
      {kids.length > 0 && (
        <div style={{ paddingLeft: 24, borderLeft: "2px solid var(--colorNeutralStroke2)", marginLeft: 20, marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {kids.map((k) => (
            <OrgNode key={k.id} contact={k} childrenOf={childrenOf} contacts={contacts} account={account}
              prospectByKey={prospectByKey} onChange={onChange} onConverted={onConverted} onError={onError} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgTree({ contacts, account, prospectByKey, onChange, onConverted, onError }) {
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
          prospectByKey={prospectByKey} onChange={onChange} onConverted={onConverted} onError={onError} />
      ))}
    </div>
  );
}

function AddContact({ accountId, contacts, onAdded, onError }) {
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
            const { ok, error } = await fetchJson("/api/account-contacts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ account_id: accountId, ...f, manager_id: f.manager_id || null }),
            });
            if (!ok) { onError(error); return; }
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

// Les données initiales arrivent du composant serveur (rendu SSR : déjà dans le
// HTML). `key={id}` côté serveur garantit un remount au changement de fiche.
// load() ne sert qu'au rafraîchissement post-action — d'où cache:"no-store"
// (le service worker sert sinon du périmé juste après une mutation).
export default function AccountClient({ id, initialData = null }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [enrichingAll, setEnrichingAll] = useState(false);

  const load = async () => {
    const { ok, data: d, error: err } = await fetchJson(`/api/accounts/${id}`, { cache: "no-store" });
    if (!ok) { setError(err); return; }
    setData(d);
  };

  const analyze = async () => {
    setBusy("analyze"); setError("");
    try {
      const { ok, error: err } = await fetchJson("/api/accounts/analyze", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      if (!ok) setError(err);
      await load();
    } finally { setBusy(""); }
  };

  const deduceOrg = async () => {
    setBusy("org"); setError("");
    try {
      const { ok, error: err } = await fetchJson(`/api/accounts/${id}/org-structure`, { method: "POST" });
      if (!ok) setError(err);
      await load();
    } finally { setBusy(""); }
  };

  const toggleWatch = async () => {
    const { ok, error: err } = await fetchJson(`/api/accounts/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto_watch: !data.account.auto_watch }),
    });
    if (!ok) { setError(err); return; }
    load();
  };

  // Synchronise l'organigramme avec les prospects du compte (voir sync-org).
  const syncOrg = async () => {
    setBusy("sync"); setError(""); setInfo("");
    try {
      const { ok, data: d, error: err } = await fetchJson(`/api/accounts/${id}/sync-org`, { method: "POST" });
      if (!ok) { setError(err); return; }
      setInfo(`${d.added} prospect(s) ajouté(s) à l'organigramme.`);
      await load();
    } finally { setBusy(""); }
  };

  // Enrichissement de masse : mis en FILE (table jobs) au lieu d'une boucle
  // d'appels pilotée par l'onglet — sur mobile, verrouiller l'écran tuait la
  // boucle à mi-parcours sans bilan. Les jobs partent aux prochains passages
  // du worker (cron Vercel + cron GitHub Actions), toujours sous budget.
  const enrichAll = async () => {
    const missing = (data.contacts || []).filter((c) => !bestChannel(c));
    if (missing.length === 0) return;
    const confirmed = confirm(
      `Mettre ${missing.length} contact(s) sans coordonnée en file d'enrichissement ?\n\n` +
      "Chaque enrichissement est une recherche IA facturée (quelques centimes " +
      "par personne, borné par le budget mensuel). Traitement automatique en " +
      "arrière-plan — tu peux fermer la page."
    );
    if (!confirmed) return;

    setEnrichingAll(true);
    setError(""); setInfo("");
    try {
      const { ok, data: d, error: err } = await fetchJson(`/api/accounts/${id}/enrich-missing`, { method: "POST" });
      if (!ok) { setError(err); return; }
      setInfo(
        d.queued > 0
          ? `${d.queued} enrichissement(s) mis en file${d.already ? ` (+${d.already} déjà en attente)` : ""}. Les coordonnées apparaîtront au fil des passages du worker.`
          : "Ces contacts sont déjà tous en file d'attente d'enrichissement."
      );
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
  // Prospects du compte absents de l'organigramme (import/scraping crée le
  // prospect sans fiche account_contacts) → proposer la synchronisation.
  const contactNameKeys = new Set(
    (contacts || []).map((c) => `${(c.first_name || "").trim()}|${(c.last_name || "").trim()}`.toLowerCase())
  );
  const missingFromOrg = (prospects || []).filter(
    (p) => !contactNameKeys.has(`${(p.first_name || "").trim()}|${(p.last_name || "").trim()}`.toLowerCase())
  ).length;
  // Personnes déjà prospects : clé nom|prénom|compte → id, pour remplacer le
  // bouton « Créer un prospect » par un lien direct vers la fiche.
  const prospectByKey = new Map(
    (prospects || []).map((p) => [
      `${p.first_name || ""}|${p.last_name || ""}|${account.name || ""}`.toLowerCase(),
      p.id,
    ])
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Header ── */}
      <div>
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/accounts"))}
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
          <span style={{ marginLeft: "auto" }}><BudgetHint /></span>
        </div>
        {busy === "analyze" && (
          <Caption1 role="status" style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 6 }}>
            Recherche web en cours, 30–90 secondes…
          </Caption1>
        )}
      </div>

      {/* ── Error / Info ── */}
      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 role="alert" style={{ color: RED }}>{error}</Body1>
        </Card>
      )}
      {info && (
        <Card style={{ borderLeft: `3px solid ${GREEN}`, padding: "12px 16px" }}>
          <Body1 role="status" style={{ color: GREEN }}>{info}</Body1>
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
              <Button appearance="subtle" size="small" icon={<Search24Regular />}
                onClick={() => router.push(`/scraping?account=${id}`)}
                title="Découvrir des décideurs et leurs emails via le scraping">
                Trouver des contacts
              </Button>
              <AddContact accountId={id} contacts={contacts} onAdded={load} onError={setError} />
            </div>
          </div>
          {missingFromOrg > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", marginBottom: 12, borderRadius: 8, background: "var(--colorNeutralBackground3)" }}>
              <Caption1 style={{ flex: 1, color: "var(--colorNeutralForeground2)" }}>
                {missingFromOrg} prospect(s) de ce compte ne figurent pas dans l'organigramme.
              </Caption1>
              <Button size="small" appearance="outline" disabled={!!busy}
                icon={busy === "sync" ? <Spinner size="tiny" /> : <People24Regular />} onClick={syncOrg}>
                Les ajouter
              </Button>
            </div>
          )}
          {contacts.length === 0 ? (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              Aucune personne cartographiée. L'analyse propose les décideurs identifiables publiquement, ou ajoute-les manuellement.
            </Caption1>
          ) : (
            <>
              <ReachSummary contacts={contacts} onEnrichAll={enrichAll} enrichingAll={enrichingAll} />
              <div style={{ marginTop: 14 }}>
                <OrgTree contacts={contacts} account={account} prospectByKey={prospectByKey}
                  onChange={load} onConverted={load} onError={setError} />
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
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>{statusLabel(p.status)}</Caption1>
            </div>
          ))}
        </Card>
      )}

      {/* ── Historique du compte (FV4) : activité agrégée de tous les contacts ── */}
      <AccountTimeline
        events={data.events || []}
        prospectById={new Map((prospects || []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]))}
      />

      {/* ── Documents (compte + contacts + prospects rattachés) ── */}
      <DocumentsCard accountId={id} />

      {/* ── Danger zone ── */}
      <div style={{ borderTop: "1px solid var(--colorNeutralStroke2)", paddingTop: 16 }}>
        <Button
          appearance="subtle"
          icon={<Delete24Regular />}
          style={{ color: RED }}
          onClick={async () => {
            if (!confirm("Supprimer ce compte et son organigramme ?")) return;
            const { ok, error: err } = await fetchJson(`/api/accounts/${id}`, { method: "DELETE" });
            if (!ok) { setError(err); return; }
            router.push("/accounts");
          }}
        >
          Supprimer le compte
        </Button>
      </div>
    </div>
  );
}
