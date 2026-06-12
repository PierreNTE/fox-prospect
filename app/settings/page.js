"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setS(d.settings)));
  }, []);

  if (!s) return <div className="empty">{error || "Chargement…"}</div>;

  const save = async () => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    const d = await res.json();
    if (d.error) setError(d.error);
    else { setSaved(true); setTimeout(() => setSaved(false), 1600); }
  };

  return (
    <>
      <h1>Réglages</h1>
      <p className="sub">Le moteur adapte recherche et brouillons à ton offre et à ton identité. Tant que tu n'es pas en poste, laisse l'offre générique : les messages resteront exploratoires.</p>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="card">
        <h2>Mon offre</h2>
        <label>Description de l'offre (mise à jour le jour où tu signes chez Palo Alto, Dell, Oracle ou AWS)</label>
        <textarea
          placeholder="Ex. : Solutions de cybersécurité réseau (NGFW, SASE, Zero Trust) pour ETI et grands comptes…"
          value={s.offer || ""}
          onChange={(e) => setS({ ...s, offer: e.target.value })}
          style={{ minHeight: 130 }}
        />
      </div>

      <div className="card">
        <h2>Identité expéditeur</h2>
        <div className="grid2">
          <div><label>Nom</label><input value={s.sender_name || ""} onChange={(e) => setS({ ...s, sender_name: e.target.value })} /></div>
          <div><label>Poste</label><input placeholder="Account Executive" value={s.sender_role || ""} onChange={(e) => setS({ ...s, sender_role: e.target.value })} /></div>
          <div><label>Société</label><input value={s.sender_company || ""} onChange={(e) => setS({ ...s, sender_company: e.target.value })} /></div>
        </div>
      </div>

      <button className="btn-fox" onClick={save}>{saved ? "Enregistré ✓" : "Enregistrer"}</button>
    </>
  );
}
