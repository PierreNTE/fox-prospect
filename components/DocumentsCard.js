"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Card, Button, Select, Body1, Caption1, Badge, Spinner } from "@fluentui/react-components";
import {
  DocumentAdd24Regular,
  Document24Regular,
  Open24Regular,
  Delete24Regular,
} from "@fluentui/react-icons";
import { fetchJson } from "@/lib/fetch-json";

const BRAND = "#5B53E6";
const RED = "#C50F1F";
const MAX_BYTES = 25 * 1024 * 1024;

export const DOC_CATEGORY_LABELS = {
  devis: "Devis",
  compte_rendu: "Compte-rendu",
  contrat: "Contrat",
  presentation: "Présentation",
  autre: "Autre",
};

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}

// Carte « Documents » : rattachés à UN compte (avec agrégation des docs des
// contacts/prospects du compte, badge « via ») ou à UN prospect.
// Upload en 2 clics (bouton → fichier) ou glisser-déposer sur la carte.
// L'upload part DIRECTEMENT du navigateur vers Supabase Storage (URL signée) —
// jamais par une route Vercel.
export default function DocumentsCard({ accountId, prospectId }) {
  const qs = accountId ? `accountId=${accountId}` : `prospectId=${prospectId}`;
  const target = accountId ? { account_id: accountId } : { prospect_id: prospectId };

  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [busyName, setBusyName] = useState("");
  const [category, setCategory] = useState("autre");
  const [filter, setFilter] = useState("tous");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const { ok, data, error: err } = await fetchJson(`/api/documents?${qs}`, { cache: "no-store" });
    if (!ok) { setError(err); setDocs((prev) => prev || []); return; }
    setError("");
    setDocs(data.documents);
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file || busyName) return;
    setError("");
    if (file.size > MAX_BYTES) { setError(`« ${file.name} » dépasse le maximum de 25 Mo.`); return; }
    setBusyName(file.name);
    try {
      const sign = await fetchJson("/api/documents/upload-url", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size }),
      });
      if (!sign.ok) { setError(sign.error); return; }

      // Upload direct navigateur → Storage (le fichier ne passe pas par Vercel).
      let put;
      try {
        put = await fetch(sign.data.signedUrl, {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });
      } catch {
        setError("Envoi interrompu (réseau). Le document n'a pas été enregistré — réessaie.");
        return;
      }
      if (!put.ok) { setError(`Envoi refusé par le Storage (${put.status}).`); return; }

      const fin = await fetchJson("/api/documents", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: sign.data.path, name: file.name, mime: file.type,
          size_bytes: file.size, category, ...target,
        }),
      });
      if (!fin.ok) { setError(fin.error); return; }
      await load();
    } finally { setBusyName(""); }
  };

  const open = async (doc) => {
    setError("");
    const { ok, data, error: err } = await fetchJson(`/api/documents/${doc.id}`);
    if (!ok) { setError(err); return; }
    window.open(data.url, "_blank", "noopener");
  };

  const remove = async (doc) => {
    if (!confirm(`Supprimer « ${doc.name} » ? Le fichier sera définitivement effacé.`)) return;
    const { ok, error: err } = await fetchJson(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (!ok) { setError(err); return; }
    load();
  };

  const all = docs || [];
  const shown = all.filter((d) => filter === "tous" || d.category === filter);
  const presentCategories = [...new Set(all.map((d) => d.category))];

  return (
    <Card
      style={{ padding: "20px 20px 22px", outline: dragging ? `2px dashed ${BRAND}` : "none" }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files?.[0]); }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Document24Regular style={{ color: BRAND }} />
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Documents</Body1>
        {all.length > 0 && <Badge appearance="outline">{all.length}</Badge>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <Select value={category} onChange={(_, d) => setCategory(d.value)} size="small" aria-label="Catégorie du document à ajouter">
            {Object.entries(DOC_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Button
            appearance="primary" size="small"
            icon={busyName ? <Spinner size="tiny" /> : <DocumentAdd24Regular />}
            disabled={!!busyName}
            onClick={() => fileRef.current?.click()}
          >
            {busyName ? "Envoi…" : "Ajouter"}
          </Button>
          <input
            ref={fileRef} type="file" style={{ display: "none" }}
            aria-label="Choisir un fichier à rattacher"
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
      </div>
      <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
        Devis, comptes-rendus, contrats… Glisse un fichier ici ou clique sur Ajouter (25 Mo max).
      </Caption1>

      {error && (
        <Caption1 role="alert" style={{ color: RED, display: "block", marginTop: 8 }}>{error}</Caption1>
      )}
      {busyName && (
        <Caption1 role="status" style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 8 }}>
          Envoi de « {busyName} » vers le stockage…
        </Caption1>
      )}

      {all.length > 0 && presentCategories.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {["tous", ...presentCategories].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              style={{
                fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                padding: "3px 10px", borderRadius: 999,
                border: `1px solid ${filter === c ? BRAND : "var(--colorNeutralStroke2)"}`,
                background: filter === c ? `color-mix(in srgb, ${BRAND} 10%, transparent)` : "transparent",
                color: filter === c ? BRAND : "var(--colorNeutralForeground2)",
              }}
              aria-pressed={filter === c}
            >
              {c === "tous" ? `Tous (${all.length})` : DOC_CATEGORY_LABELS[c] || c}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {docs === null ? (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Chargement…</Caption1>
        ) : shown.length === 0 ? (
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", padding: "10px 0" }}>
            {all.length === 0
              ? "Aucun document pour l'instant. Le premier devis ou compte-rendu se dépose ici."
              : "Aucun document dans cette catégorie."}
          </Caption1>
        ) : (
          shown.map((d) => (
            <div
              key={d.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--colorNeutralStroke2)" }}
            >
              <Document24Regular style={{ flexShrink: 0, color: "var(--colorNeutralForeground3)", fontSize: 18 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <button
                  onClick={() => open(d)}
                  title="Ouvrir (prévisualisation)"
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--colorNeutralForeground1)", fontSize: 13.5, fontWeight: 600, textAlign: "left", fontFamily: "inherit", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}
                >
                  {d.name}
                </button>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                  {DOC_CATEGORY_LABELS[d.category] || d.category} · {fmtSize(d.size_bytes)} · {new Date(d.created_at).toLocaleDateString("fr-FR")}
                  {d.via ? ` · via ${d.via}` : ""}
                </Caption1>
              </div>
              <Button appearance="subtle" size="small" icon={<Open24Regular />} title="Ouvrir" aria-label={`Ouvrir ${d.name}`} onClick={() => open(d)} />
              <Button appearance="subtle" size="small" icon={<Delete24Regular />} title="Supprimer" aria-label={`Supprimer ${d.name}`} onClick={() => remove(d)} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
