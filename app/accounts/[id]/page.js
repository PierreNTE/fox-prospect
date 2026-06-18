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
  Divider,
} from "@fluentui/react-components";
import {
  ArrowClockwise24Regular,
  Eye24Regular,
  EyeOff24Regular,
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
  Lightbulb24Regular,
  People24Regular,
  ArrowLeft24Regular,
} from "@fluentui/react-icons";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const RED = "#C50F1F";
const AMBER = "#F6A623";

const RELIABILITY = {
  verifie: { label: "Vérifié", color: GREEN },
  partiel: { label: "Partiel", color: AMBER },
  non_verifie: { label: "Non vérifié", color: "var(--colorNeutralForeground3)" },
};
const CONFIDENCE = { certain: "certain", probable: "probable", incertain: "incertain" };

function RelBadge({ value }) {
  const r = RELIABILITY[value] || RELIABILITY.non_verifie;
  return <Badge appearance="outline" style={{ borderColor: r.color, color: r.color }}>{r.label}</Badge>;
}

function SourceLink({ source }) {
  if (!source) return null;
  const isUrl = /^https?:\/\//i.test(source);
  if (!isUrl) return <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>· {source}</Caption1>;
  let domain = source;
  try { domain = new URL(source).hostname.replace(/^www\./, ""); } catch {}
  return (
    <>
      {" · "}
      <a href={source} target="_blank" rel="noreferrer"
        style={{ color: BRAND, textDecoration: "none" }}>
        {domain} ↗
      </a>
    </>
  );
}

function NewsItem({ n }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
      <Body1 style={{ fontWeight: 600, display: "block" }}>
        {n.title || n.category}
        {n.detail && <span style={{ fontWeight: 400, color: "var(--colorNeutralForeground2)" }}> — {n.detail}</span>}
      </Body1>
      <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 3 }}>
        {n.date}
        <SourceLink source={n.source} />
        {n.scope && n.scope !== "groupe" && <> · {n.scope}</>}
      </Caption1>
    </div>
  );
}

function ContactCard({ contact, contacts, onChange }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(contact);

  const save = async () => {
    await fetch(`/api/account-contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: f.first_name, last_name: f.last_name, role: f.role,
        responsibilities: f.responsibilities, email: f.email, phone: f.phone,
        linkedin_url: f.linkedin_url, reliability: f.reliability,
        role_confidence: f.role_confidence, data_date: f.data_date,
        manager_id: f.manager_id || null, source: f.source,
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
    if (!confirm("Retirer cette personne de la cartographie ?")) return;
    await fetch(`/api/account-contacts/${contact.id}`, { method: "DELETE" });
    onChange();
  };

  if (editing) {
    return (
      <Card style={{ padding: 16, marginBottom: 8, borderLeft: `3px solid ${BRAND}` }}>
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
        <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Poste</Caption1>
        <Input value={f.role || ""} onChange={(_, d) => setF({ ...f, role: d.value })} style={{ marginBottom: 10 }} />
        <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Responsabilités</Caption1>
        <Input value={f.responsibilities || ""} onChange={(_, d) => setF({ ...f, responsibilities: d.value })} style={{ marginBottom: 10 }} />
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Fiabilité</Caption1>
            <Select value={f.reliability} onChange={(_, d) => setF({ ...f, reliability: d.value })}>
              <option value="verifie">Vérifié</option>
              <option value="partiel">Partiellement vérifié</option>
              <option value="non_verifie">Non vérifié</option>
            </Select>
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Responsable</Caption1>
            <Select value={f.manager_id || ""} onChange={(_, d) => setF({ ...f, manager_id: d.value })}>
              <option value="">— aucun —</option>
              {contacts.filter((c) => c.id !== contact.id).map((c) => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </Select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button appearance="primary" onClick={save}>Enregistrer</Button>
          <Button appearance="outline" onClick={() => { setF(contact); setEditing(false); }}>Annuler</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{
      padding: "14px 16px", marginBottom: 8,
      borderLeft: `3px solid ${contact.validated ? GREEN : AMBER}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <Body1 style={{ fontWeight: 700 }}>{contact.first_name} {contact.last_name}</Body1>
            {!contact.validated && (
              <Badge appearance="tint" color="warning">proposé par l'IA</Badge>
            )}
          </div>
          {contact.role && (
            <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block" }}>{contact.role}</Caption1>
          )}
          {contact.responsibilities && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>{contact.responsibilities}</Caption1>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <RelBadge value={contact.reliability} />
            {contact.role_confidence && (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                poste : {CONFIDENCE[contact.role_confidence] || contact.role_confidence}
              </Caption1>
            )}
            {contact.data_date && (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>· info {contact.data_date}</Caption1>
            )}
          </div>
          {(contact.email || contact.phone || contact.linkedin_url) && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
              {contact.email && (
                <a href={`mailto:${contact.email}`} style={{ display: "flex", alignItems: "center", gap: 4, color: BRAND, textDecoration: "none", fontSize: 13 }}>
                  <Mail24Regular style={{ fontSize: 15 }} />{contact.email}
                </a>
              )}
              {contact.phone && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--colorNeutralForeground2)", fontSize: 13 }}>
                  <Phone24Regular style={{ fontSize: 15 }} />{contact.phone}
                </span>
              )}
              {contact.linkedin_url && (
                <a href={contact.linkedin_url} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 4, color: BRAND, textDecoration: "none", fontSize: 13 }}>
                  <LinkSquare24Regular style={{ fontSize: 15 }} />LinkedIn ↗
                </a>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
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

function OrgNode({ contact, childrenOf, contacts, onChange }) {
  const kids = childrenOf(contact.id);
  return (
    <div style={{ paddingLeft: 0 }}>
      <ContactCard contact={contact} contacts={contacts} onChange={onChange} />
      {kids.length > 0 && (
        <div style={{ paddingLeft: 24, borderLeft: "2px solid var(--colorNeutralStroke2)", marginLeft: 16, marginTop: 0 }}>
          {kids.map((k) => (
            <OrgNode key={k.id} contact={k} childrenOf={childrenOf} contacts={contacts} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgTree({ contacts, onChange }) {
  const childrenOf = (mid) => contacts.filter((c) => c.manager_id === mid);
  const ids = new Set(contacts.map((c) => c.id));
  const roots = contacts.filter((c) => !c.manager_id || !ids.has(c.manager_id));
  return (
    <div>
      {roots.map((c) => (
        <OrgNode key={c.id} contact={c} childrenOf={childrenOf} contacts={contacts} onChange={onChange} />
      ))}
    </div>
  );
}

function AddContact({ accountId, contacts, onAdded }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ first_name: "", last_name: "", role: "", manager_id: "" });

  if (!open) {
    return (
      <Button appearance="outline" size="small" icon={<PersonAdd24Regular />} onClick={() => setOpen(true)}>
        Ajouter une personne
      </Button>
    );
  }

  return (
    <Card style={{ padding: 16, marginTop: 12, borderLeft: `3px solid ${BRAND}` }}>
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
      <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Poste</Caption1>
      <Input value={f.role} onChange={(_, d) => setF({ ...f, role: d.value })} style={{ marginBottom: 10 }} />
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
            setF({ first_name: "", last_name: "", role: "", manager_id: "" });
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

/* ── Page ── */

export default function AccountPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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
  const news = account.news || [];
  const generalNews = news.filter((n) => !n.scope || n.scope === "groupe");
  const deptNews = news.filter((n) => n.scope && n.scope !== "groupe");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div>
        <button
          onClick={() => router.push("/accounts")}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "var(--colorNeutralForeground3)", fontSize: 13, padding: "0 0 10px", marginLeft: -4 }}
        >
          <ArrowLeft24Regular style={{ fontSize: 16 }} /> Comptes
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <Title2>{account.name}</Title2>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              {account.sector && (
                <Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{account.sector}</Caption1>
              )}
              {account.hq && (
                <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>· {account.hq}</Caption1>
              )}
              {account.website && (
                <a href={account.website} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 4, color: BRAND, textDecoration: "none", fontSize: 13 }}>
                  <Globe24Regular style={{ fontSize: 15 }} />Site ↗
                </a>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Button
              appearance={account.auto_watch ? "primary" : "outline"}
              icon={account.auto_watch ? <Eye24Regular /> : <EyeOff24Regular />}
              size="small"
              onClick={toggleWatch}
            >
              {account.auto_watch ? "Veille auto ON" : "Veille auto OFF"}
            </Button>
            <Button
              appearance="primary"
              icon={busy === "analyze" ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />}
              disabled={!!busy}
              onClick={analyze}
            >
              {account.last_refreshed_at ? "Rafraîchir" : "Analyser"}
            </Button>
          </div>
        </div>
        {busy === "analyze" && (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 8 }}>
            Recherche web en cours, 30–90 secondes…
          </Caption1>
        )}
        {account.last_refreshed_at && (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>
            Dernière veille : {new Date(account.last_refreshed_at).toLocaleString("fr-FR")}
          </Caption1>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── Not yet analyzed ── */}
      {!account.last_refreshed_at && !busy && (
        <Card style={{ padding: "32px 24px", textAlign: "center" }}>
          <Building24Regular style={{ fontSize: 40, color: "var(--colorNeutralForeground3)", display: "block", margin: "0 auto 12px" }} />
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>
            Compte pas encore analysé. Lance l'analyse pour identifier les décideurs IT, actualités et signaux stratégiques.
          </Body1>
        </Card>
      )}

      {/* ── Summary ── */}
      {account.summary && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <Body1 style={{ fontWeight: 700, fontSize: 15, display: "block", marginBottom: 10 }}>Synthèse</Body1>
          <Body1 style={{ color: "var(--colorNeutralForeground2)", lineHeight: 1.6 }}>{account.summary}</Body1>
        </Card>
      )}

      {/* ── Org chart (contacts) ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <People24Regular style={{ color: BRAND }} />
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Organigramme IT</Body1>
            {contacts.length > 0 && (
              <Badge appearance="outline">{contacts.length} personne{contacts.length > 1 ? "s" : ""}</Badge>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {contacts.length >= 2 && (
              <Button appearance="outline" size="small" disabled={!!busy} onClick={deduceOrg}
                icon={busy === "org" ? <Spinner size="tiny" /> : <People24Regular />}>
                Déduire l'organigramme
              </Button>
            )}
            <AddContact accountId={id} contacts={contacts} onAdded={load} />
          </div>
        </div>
        {contacts.length === 0 ? (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
            Aucune personne cartographiée. L'analyse propose les décideurs IT identifiables publiquement.
          </Caption1>
        ) : (
          <OrgTree contacts={contacts} onChange={load} />
        )}
      </Card>

      {/* ── Prospects actifs ── */}
      {prospects.length > 0 && (
        <Card style={{ padding: "20px 20px 24px" }}>
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

      {/* ── Actualités générales ── */}
      {generalNews.length > 0 && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <News24Regular style={{ color: BRAND }} />
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Actualités générales</Body1>
          </div>
          {generalNews.map((n, i) => <NewsItem key={i} n={n} />)}
        </Card>
      )}

      {/* ── Actualités par direction ── */}
      {deptNews.length > 0 && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <News24Regular style={{ color: AMBER }} />
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Actualités par direction</Body1>
          </div>
          {deptNews.map((n, i) => <NewsItem key={i} n={n} />)}
        </Card>
      )}

      {/* ── Signaux stratégiques ── */}
      {(account.signals || []).length > 0 && (
        <Card style={{ padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Lightbulb24Regular style={{ color: AMBER }} />
            <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Signaux stratégiques</Body1>
          </div>
          {account.signals.map((s, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
              <Body1 style={{ fontWeight: 600 }}>{s.type} — {s.detail}</Body1>
              <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 3 }}>
                {s.date}
                <SourceLink source={s.source} />
                {s.confidence && <> · confiance : {CONFIDENCE[s.confidence] || s.confidence}</>}
              </Caption1>
            </div>
          ))}
        </Card>
      )}

      {/* ── Sources ── */}
      {(account.sources || []).length > 0 && (
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          Sources :{" "}
          {account.sources.map((u, i) => (
            <span key={i}>
              <a href={u} target="_blank" rel="noreferrer" style={{ color: BRAND }}>[{i + 1}]</a>{" "}
            </span>
          ))}
        </Caption1>
      )}

      {/* ── Danger zone ── */}
      <div style={{ borderTop: "1px solid var(--colorNeutralStroke2)", paddingTop: 16 }}>
        <Button
          appearance="outline"
          icon={<Delete24Regular />}
          style={{ color: RED, borderColor: RED }}
          onClick={async () => {
            if (!confirm("Supprimer ce compte et sa cartographie ?")) return;
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
