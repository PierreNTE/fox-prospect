"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EMPTY = { first_name: "", last_name: "", role: "", company: "", company_website: "", linkedin_url: "", email: "" };

// Mappe les en-têtes usuels (FR/EN, exports Sales Nav, CSV maison) vers nos champs.
const HEADER_MAP = {
  prenom: "first_name", "prénom": "first_name", firstname: "first_name", "first name": "first_name", first_name: "first_name",
  nom: "last_name", lastname: "last_name", "last name": "last_name", last_name: "last_name",
  poste: "role", fonction: "role", titre: "role", title: "role", role: "role", "job title": "role",
  entreprise: "company", societe: "company", "société": "company", company: "company", "company name": "company",
  site: "company_website", "site web": "company_website", website: "company_website", domaine: "company_website", company_website: "company_website",
  linkedin: "linkedin_url", "linkedin url": "linkedin_url", "profil linkedin": "linkedin_url", linkedin_url: "linkedin_url",
  email: "email", mail: "email", "e-mail": "email", courriel: "email",
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const split = (line) => {
    const out = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === delim && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim().replace(/^"|"$/g, ""));
  };
  const headers = split(lines[0]).map((h) => HEADER_MAP[h.toLowerCase().trim()] || null);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row = { ...EMPTY };
    headers.forEach((field, i) => { if (field && cells[i]) row[field] = cells[i]; });
    return row;
  }).filter((r) => r.company);
}

export default function ImportPage() {
  const router = useRouter();
  const [manual, setManual] = useState({ ...EMPTY });
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState([]);
  const [message, setMessage] = useState(null);

  const send = async (rows) => {
    const res = await fetch("/api/prospects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rows),
    });
    const d = await res.json();
    if (d.error) setMessage({ type: "err", text: d.error });
    else {
      setMessage({ type: "ok", text: `${d.inserted} prospect(s) ajouté(s)${d.duplicates ? `, ${d.duplicates} doublon(s) ignoré(s)` : ""}${d.skipped - (d.duplicates || 0) > 0 ? `, ${d.skipped - (d.duplicates || 0)} ligne(s) invalide(s)` : ""}.` });
      setTimeout(() => router.push("/"), 1100);
    }
  };

  return (
    <>
      <h1>Importer des prospects</h1>
      <p className="sub">À la main pour un contact repéré, ou en collant un CSV (export Sales Navigator, SIRENE, fichier maison).</p>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <div className="card">
        <h2>Ajout manuel</h2>
        <div className="grid2">
          <div><label>Prénom</label><input value={manual.first_name} onChange={(e) => setManual({ ...manual, first_name: e.target.value })} /></div>
          <div><label>Nom</label><input value={manual.last_name} onChange={(e) => setManual({ ...manual, last_name: e.target.value })} /></div>
          <div><label>Poste</label><input placeholder="DSI, RSSI, Responsable infrastructure…" value={manual.role} onChange={(e) => setManual({ ...manual, role: e.target.value })} /></div>
          <div><label>Entreprise *</label><input value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} /></div>
          <div><label>Site web</label><input placeholder="https://…" value={manual.company_website} onChange={(e) => setManual({ ...manual, company_website: e.target.value })} /></div>
          <div><label>URL LinkedIn</label><input placeholder="https://www.linkedin.com/in/…" value={manual.linkedin_url} onChange={(e) => setManual({ ...manual, linkedin_url: e.target.value })} /></div>
          <div><label>Email pro (si connu)</label><input value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} /></div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="btn-fox"
            onClick={() => {
              if (!manual.company || (!manual.first_name && !manual.last_name)) {
                setMessage({ type: "err", text: "Entreprise et au moins un nom sont requis." });
                return;
              }
              send([manual]);
            }}
          >
            Ajouter à la piste
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Import CSV</h2>
        <p className="sub small">
          Colonnes reconnues : prénom, nom, poste, entreprise, site, linkedin, email — en français ou en anglais, séparateur , ou ;
        </p>
        <textarea
          placeholder={"prenom;nom;poste;entreprise;email\nMarie;Durand;DSI;Acme Industries;m.durand@acme.fr"}
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setPreview(parseCsv(e.target.value)); }}
          style={{ minHeight: 150, fontFamily: "monospace", fontSize: 13 }}
        />
        {csv.trim() && preview.length === 0 && (
          <div className="alert alert-err">
            Aucune ligne reconnue. Vérifie que la première ligne contient des en-têtes
            (prénom, nom, poste, entreprise, email…) et que le séparateur est cohérent.
          </div>
        )}
        {preview.length > 0 && (
          <>
            <p className="small" style={{ marginTop: 12 }}><strong>{preview.length} ligne(s) détectée(s)</strong> — aperçu :</p>
            <table>
              <thead><tr><th>Contact</th><th>Poste</th><th>Entreprise</th><th>Email</th></tr></thead>
              <tbody>
                {preview.slice(0, 5).map((r, i) => (
                  <tr key={i}><td>{r.first_name} {r.last_name}</td><td className="sub">{r.role}</td><td>{r.company}</td><td className="sub">{r.email}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn-fox" onClick={() => send(preview)}>Importer {preview.length} prospect(s)</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
