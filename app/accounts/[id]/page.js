"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const RELIABILITY = {
  verifie: { label: "Vérifié", cls: "rel-verifie" },
  partiel: { label: "Partiellement vérifié", cls: "rel-partiel" },
  non_verifie: { label: "Non vérifié", cls: "rel-non" },
};
const CONFIDENCE = { certain: "certain", probable: "probable", incertain: "incertain" };

function RelBadge({ value }) {
  const r = RELIABILITY[value] || RELIABILITY.non_verifie;
  return <span className={`relbadge ${r.cls}`}>{r.label}</span>;
}

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
    setBusy("analyze");
    setError("");
    try {
      const res = await fetch("/api/accounts/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) setError(d.error || `Erreur ${res.status}.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const toggleWatch = async () => {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto_watch: !data.account.auto_watch }),
    });
    load();
  };

  if (!data) return <div className="empty">{error || "Chargement…"}</div>;

  const { account, contacts, prospects } = data;
  const news = account.news || [];
  const generalNews = news.filter((n) => !n.scope || n.scope === "groupe");
  const deptNews = news.filter((n) => n.scope && n.scope !== "groupe");

  return (
    <>
      <div className="row spread">
        <div>
          <h1>{account.name}</h1>
          <p className="sub">
            {account.sector || "Secteur inconnu"}{account.hq && <> · {account.hq}</>}
            {account.website && <> · <a href={account.website} target="_blank" rel="noreferrer">Site ↗</a></>}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="row" style={{ margin: "14px 0 20px" }}>
        <button className="btn-fox" disabled={!!busy} onClick={analyze}>
          {busy === "analyze" && <span className="spin" />}
          {account.last_refreshed_at ? "Rafraîchir l'analyse" : "Analyser ce compte"}
        </button>
        {busy === "analyze" && <span className="sub small">Recherche web en cours, 30-90 secondes…</span>}
        {account.last_refreshed_at && (
          <span className="sub small">Dernière veille : {new Date(account.last_refreshed_at).toLocaleString("fr-FR")}</span>
        )}
        <label className="toggle">
          <input type="checkbox" checked={!!account.auto_watch} onChange={toggleWatch} />
          Veille auto
        </label>
      </div>

      {!account.last_refreshed_at && !busy && (
        <div className="card empty">
          <p>Compte pas encore analysé. Lance l'analyse : identité, actualités, signaux stratégiques et cartographie IT (sourcés et datés).</p>
        </div>
      )}

      {account.summary && (
        <div className="card">
          <h2>Synthèse</h2>
          <p>{account.summary}</p>
        </div>
      )}

      {/* Organigramme IT */}
      <div className="card">
        <div className="row spread">
          <h2>Organigramme IT</h2>
          <AddContact accountId={id} contacts={contacts} onAdded={load} />
        </div>
        {contacts.length === 0 ? (
          <p className="sub small">
            Aucune personne cartographiée. L'analyse propose les décideurs IT identifiables publiquement ;
            conformément à la règle « rien d'inventé », cette liste peut être courte ou vide.
          </p>
        ) : (
          <OrgTree contacts={contacts} onChange={load} />
        )}
      </div>

      {/* Prospects actifs rattachés */}
      {prospects.length > 0 && (
        <div className="card">
          <h2>Prospects en cours sur ce compte</h2>
          {prospects.map((p) => (
            <div key={p.id} className="row spread linkrow" onClick={() => router.push(`/prospects/${p.id}`)}>
              <span><strong>{p.first_name} {p.last_name}</strong> <span className="sub">— {p.role || "poste inconnu"}</span></span>
              <span className="sub small">{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actualités */}
      {generalNews.length > 0 && (
        <div className="card">
          <h2>Actualités générales</h2>
          {generalNews.map((n, i) => <NewsItem key={i} n={n} />)}
        </div>
      )}
      {deptNews.length > 0 && (
        <div className="card">
          <h2>Actualités par direction</h2>
          {deptNews.map((n, i) => <NewsItem key={i} n={n} />)}
        </div>
      )}

      {/* Signaux stratégiques */}
      {(account.signals || []).length > 0 && (
        <div className="card">
          <h2>Signaux stratégiques</h2>
          {account.signals.map((s, i) => (
            <div key={i} className="signal">
              <div><strong>{s.type}</strong> — {s.detail}</div>
              <div className="meta">
                {s.date} {s.source && <>· {s.source}</>}
                {s.confidence && <> · confiance : {CONFIDENCE[s.confidence] || s.confidence}</>}
              </div>
            </div>
          ))}
        </div>
      )}

      {(account.sources || []).length > 0 && (
        <p className="sub small">
          Sources : {account.sources.map((u, i) => (
            <span key={i}><a href={u} target="_blank" rel="noreferrer">[{i + 1}]</a>{" "}</span>
          ))}
        </p>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        <button
          onClick={async () => {
            if (!confirm("Supprimer ce compte et sa cartographie ?")) return;
            await fetch(`/api/accounts/${id}`, { method: "DELETE" });
            router.push("/accounts");
          }}
        >
          Supprimer le compte
        </button>
      </div>
    </>
  );
}

function NewsItem({ n }) {
  return (
    <div className="signal">
      <div><strong>{n.title || n.category}</strong>{n.detail && <> — {n.detail}</>}</div>
      <div className="meta">{n.date} {n.source && <>· {n.source}</>} {n.scope && n.scope !== "groupe" && <>· {n.scope}</>}</div>
    </div>
  );
}

// Arbre organisationnel : racines = contacts sans responsable connu.
function OrgTree({ contacts, onChange }) {
  const childrenOf = (mid) => contacts.filter((c) => c.manager_id === mid);
  const ids = new Set(contacts.map((c) => c.id));
  const roots = contacts.filter((c) => !c.manager_id || !ids.has(c.manager_id));
  return (
    <div className="orgtree">
      {roots.map((c) => <OrgNode key={c.id} contact={c} childrenOf={childrenOf} contacts={contacts} onChange={onChange} />)}
    </div>
  );
}

function OrgNode({ contact, childrenOf, contacts, onChange }) {
  const kids = childrenOf(contact.id);
  return (
    <div className="orgnode">
      <ContactCard contact={contact} contacts={contacts} onChange={onChange} />
      {kids.length > 0 && (
        <div className="orgchildren">
          {kids.map((k) => <OrgNode key={k.id} contact={k} childrenOf={childrenOf} contacts={contacts} onChange={onChange} />)}
        </div>
      )}
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
      <div className="contactcard editing">
        <div className="grid2">
          <div><label>Prénom</label><input value={f.first_name || ""} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
          <div><label>Nom</label><input value={f.last_name || ""} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
        </div>
        <label>Poste</label><input value={f.role || ""} onChange={(e) => setF({ ...f, role: e.target.value })} />
        <label>Responsabilités</label><input value={f.responsibilities || ""} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} />
        <div className="grid2">
          <div><label>Email</label><input value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><label>Téléphone</label><input value={f.phone || ""} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <label>LinkedIn</label><input value={f.linkedin_url || ""} onChange={(e) => setF({ ...f, linkedin_url: e.target.value })} />
        <div className="grid2">
          <div>
            <label>Fiabilité des coordonnées</label>
            <select value={f.reliability} onChange={(e) => setF({ ...f, reliability: e.target.value })}>
              <option value="verifie">Vérifié</option>
              <option value="partiel">Partiellement vérifié</option>
              <option value="non_verifie">Non vérifié</option>
            </select>
          </div>
          <div>
            <label>Responsable hiérarchique</label>
            <select value={f.manager_id || ""} onChange={(e) => setF({ ...f, manager_id: e.target.value })}>
              <option value="">— aucun —</option>
              {contacts.filter((c) => c.id !== contact.id).map((c) => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn-fox" onClick={save}>Enregistrer</button>
          <button onClick={() => { setF(contact); setEditing(false); }}>Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`contactcard ${contact.validated ? "validated" : "proposed"}`}>
      <div className="row spread">
        <div>
          <strong>{contact.first_name} {contact.last_name}</strong>
          {!contact.validated && <span className="proposed-tag">proposé par l'IA</span>}
          <div className="sub small">{contact.role || "poste inconnu"}</div>
          {contact.responsibilities && <div className="sub small">{contact.responsibilities}</div>}
          <div className="contactmeta">
            <RelBadge value={contact.reliability} />
            {contact.role_confidence && <span className="sub small">poste : {CONFIDENCE[contact.role_confidence] || contact.role_confidence}</span>}
            {contact.data_date && <span className="sub small">· info {contact.data_date}</span>}
          </div>
          {(contact.email || contact.phone || contact.linkedin_url) && (
            <div className="sub small" style={{ marginTop: 4 }}>
              {contact.email && <>✉ {contact.email} </>}
              {contact.phone && <>· ☎ {contact.phone} </>}
              {contact.linkedin_url && <>· <a href={contact.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></>}
            </div>
          )}
          {contact.source && <div className="sub small" style={{ marginTop: 2 }}>Source : {contact.source}</div>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        {!contact.validated && <button onClick={validate}>✓ Valider</button>}
        <button onClick={() => setEditing(true)}>Éditer</button>
        <button onClick={remove}>Retirer</button>
      </div>
    </div>
  );
}

function AddContact({ accountId, contacts, onAdded }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ first_name: "", last_name: "", role: "", manager_id: "" });

  if (!open) return <button onClick={() => setOpen(true)}>+ Ajouter une personne</button>;

  return (
    <div className="card" style={{ width: "100%", marginTop: 12 }}>
      <div className="grid2">
        <div><label>Prénom</label><input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
        <div><label>Nom</label><input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
      </div>
      <label>Poste</label><input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
      <label>Responsable hiérarchique</label>
      <select value={f.manager_id} onChange={(e) => setF({ ...f, manager_id: e.target.value })}>
        <option value="">— aucun —</option>
        {contacts.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
      </select>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn-fox"
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
        </button>
        <button onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </div>
  );
}
