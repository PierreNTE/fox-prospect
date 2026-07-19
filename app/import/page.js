"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Button,
  Input,
  Textarea,
  Title2,
  Body1,
  Caption1,
  Spinner,
  Table,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
  TableHeaderCell,
} from "@fluentui/react-components";
import { fetchJson } from "@/lib/fetch-json";
import {
  LinkSquare24Regular,
  PersonAdd24Regular,
  DocumentTable24Regular,
  ArrowUpload24Regular,
  Add24Regular,
  CheckmarkCircle24Regular,
  ErrorCircle24Regular,
} from "@fluentui/react-icons";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const RED = "#C50F1F";

const EMPTY = { first_name: "", last_name: "", role: "", company: "", company_website: "", linkedin_url: "", email: "", phone: "" };

const HEADER_MAP = {
  prenom: "first_name", "prénom": "first_name", firstname: "first_name", "first name": "first_name", first_name: "first_name",
  nom: "last_name", lastname: "last_name", "last name": "last_name", last_name: "last_name",
  poste: "role", fonction: "role", titre: "role", title: "role", role: "role", "job title": "role",
  entreprise: "company", societe: "company", "société": "company", company: "company", "company name": "company",
  site: "company_website", "site web": "company_website", website: "company_website", domaine: "company_website", company_website: "company_website",
  linkedin: "linkedin_url", "linkedin url": "linkedin_url", "profil linkedin": "linkedin_url", linkedin_url: "linkedin_url",
  email: "email", mail: "email", "e-mail": "email", courriel: "email",
  telephone: "phone", "téléphone": "phone", tel: "phone", "tél": "phone", phone: "phone", mobile: "phone", portable: "phone", "phone number": "phone",
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const split = (line) => {
    const out = []; let cur = "", inQ = false;
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
  const [liUrl, setLiUrl] = useState("");
  const [liBusy, setLiBusy] = useState(false);
  const [liResult, setLiResult] = useState(null);

  const lookupLinkedin = async () => {
    setLiBusy(true); setMessage(null); setLiResult(null);
    const { ok, data: d, error } = await fetchJson("/api/import-linkedin", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ linkedinUrl: liUrl }),
    });
    setLiBusy(false);
    if (!ok) { setMessage({ type: "err", text: error }); return; }
    setManual({ ...EMPTY, ...d.prospect });
    setLiResult(d);
    setMessage({ type: "ok", text: `Profil identifié (confiance ${d.confidence}). Vérifie les champs ci-dessous, complète si besoin, puis ajoute aux prospects.` });
  };

  const send = async (rows) => {
    const { ok, data: d, error } = await fetchJson("/api/prospects", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(rows),
    });
    if (!ok) { setMessage({ type: "err", text: error }); return; }
    const invalid = d.skipped - (d.duplicates || 0) - (d.no_contact || 0);
    setMessage({ type: "ok", text: `${d.inserted} prospect(s) ajouté(s)${d.duplicates ? `, ${d.duplicates} doublon(s) ignoré(s)` : ""}${d.no_contact ? `, ${d.no_contact} sans coordonnée (non ajoutés)` : ""}${invalid > 0 ? `, ${invalid} ligne(s) invalide(s)` : ""}.` });
    setTimeout(() => router.push("/"), 1100);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Title2>Importer des prospects</Title2>
        <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
          À la main pour un contact repéré, ou en collant un CSV (Sales Navigator, SIRENE, fichier maison).
        </Body1>
      </div>

      {/* ── Toast ── */}
      {message && (
        <Card style={{ borderLeft: `3px solid ${message.type === "ok" ? GREEN : RED}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          {message.type === "ok"
            ? <CheckmarkCircle24Regular style={{ color: GREEN, flexShrink: 0 }} />
            : <ErrorCircle24Regular style={{ color: RED, flexShrink: 0 }} />}
          <Body1 role={message.type === "ok" ? "status" : "alert"} style={{ color: message.type === "ok" ? GREEN : RED }}>
            {message.text}
          </Body1>
        </Card>
      )}

      {/* ── LinkedIn ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <LinkSquare24Regular style={{ color: "#0077b5" }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Depuis un profil LinkedIn</Body1>
        </div>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 12 }}>
          Colle l'URL du profil : l'app identifie la personne via le web public (pas de scraping LinkedIn) et pré-remplit le formulaire.
        </Caption1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Input
            type="url"
            placeholder="https://www.linkedin.com/in/…"
            value={liUrl}
            onChange={(_, d) => setLiUrl(d.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <Button appearance="primary" disabled={liBusy || !liUrl.trim()} onClick={lookupLinkedin}
            icon={liBusy ? <Spinner size="tiny" /> : <LinkSquare24Regular />}>
            {liBusy ? "Identification…" : "Identifier"}
          </Button>
        </div>
        {liBusy && (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 8 }}>
            Recherche web en cours, 20-60 secondes…
          </Caption1>
        )}
        {liResult?.notes && (
          <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 8 }}>{liResult.notes}</Caption1>
        )}
      </Card>

      {/* ── Manual form ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <PersonAdd24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Ajout manuel</Body1>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 16 }}>
          {[
            { label: "Prénom", field: "first_name", placeholder: "" },
            { label: "Nom", field: "last_name", placeholder: "" },
            { label: "Poste", field: "role", placeholder: "DSI, RSSI, Responsable infrastructure…" },
            { label: "Entreprise *", field: "company", placeholder: "" },
            { label: "Site web", field: "company_website", placeholder: "https://…", type: "url" },
            { label: "URL LinkedIn", field: "linkedin_url", placeholder: "https://www.linkedin.com/in/…", type: "url" },
            { label: "Email pro (si connu)", field: "email", placeholder: "", type: "email" },
            { label: "Téléphone (si connu)", field: "phone", placeholder: "+33 6…", type: "tel" },
          ].map(({ label, field, placeholder, type }) => (
            <div key={field}>
              {/* Vrai label associé (htmlFor/id) : lecteurs d'écran et
                  gestionnaires de mots de passe identifient enfin les champs. */}
              <label htmlFor={`manual-${field}`} style={{ display: "block", marginBottom: 4, fontWeight: 600, fontSize: 12 }}>
                {label}
              </label>
              <Input
                id={`manual-${field}`}
                type={type || "text"}
                placeholder={placeholder}
                value={manual[field]}
                onChange={(_, d) => setManual({ ...manual, [field]: d.value })}
              />
            </div>
          ))}
        </div>
        <Button
          appearance="primary"
          icon={<Add24Regular />}
          onClick={() => {
            if (!manual.company || (!manual.first_name && !manual.last_name)) {
              setMessage({ type: "err", text: "Entreprise et au moins un nom sont requis." });
              return;
            }
            send([manual]);
          }}
        >
          Ajouter aux prospects
        </Button>
      </Card>

      {/* ── CSV import ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <DocumentTable24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Import CSV</Body1>
        </div>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 12 }}>
          Colonnes reconnues : prénom, nom, poste, entreprise, site, linkedin, email, téléphone — en français ou en anglais, séparateur , ou ;
        </Caption1>
        <Textarea
          placeholder={"prenom;nom;poste;entreprise;email\nMarie;Durand;DSI;Acme Industries;m.durand@acme.fr"}
          value={csv}
          onChange={(_, d) => { setCsv(d.value); setPreview(parseCsv(d.value)); }}
          rows={6}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }}
        />

        {csv.trim() && preview.length === 0 && (
          <Card style={{ borderLeft: `3px solid ${RED}`, padding: "10px 12px", marginTop: 10 }}>
            <Caption1 style={{ color: RED }}>
              Aucune ligne reconnue. Vérifie que la première ligne contient des en-têtes (prénom, nom, poste, entreprise, email…).
            </Caption1>
          </Card>
        )}

        {preview.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <Body1 style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>
              {preview.length} ligne(s) détectée(s) — aperçu :
            </Body1>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Contact</TableHeaderCell>
                  <TableHeaderCell>Poste</TableHeaderCell>
                  <TableHeaderCell>Entreprise</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.slice(0, 5).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell><Body1 style={{ fontWeight: 600 }}>{r.first_name} {r.last_name}</Body1></TableCell>
                    <TableCell><Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{r.role}</Caption1></TableCell>
                    <TableCell><Body1>{r.company}</Body1></TableCell>
                    <TableCell><Caption1 style={{ color: "var(--colorNeutralForeground2)" }}>{r.email}</Caption1></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div style={{ marginTop: 14 }}>
              <Button appearance="primary" icon={<ArrowUpload24Regular />} onClick={() => send(preview)}>
                Importer {preview.length} prospect(s)
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
