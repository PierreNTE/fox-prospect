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

  const icp = s.icp || {};
  const setIcp = (next) => setS({ ...s, icp: next });

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
      <p className="sub">
        Le moteur adapte recherche et brouillons à ton offre et à ton identité.
        L'ICP affine le score Business de chaque prospect.
      </p>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="card">
        <h2>Mon offre</h2>
        <label>
          Description de l'offre (mise à jour le jour où tu signes chez Palo Alto, Dell, Oracle ou AWS)
        </label>
        <textarea
          placeholder="Ex. : Solutions de cybersécurité réseau (NGFW, SASE, Zero Trust) pour ETI et grands comptes…"
          value={s.offer || ""}
          onChange={(e) => setS({ ...s, offer: e.target.value })}
          style={{ minHeight: 130 }}
        />
      </div>

      {/* ── Profil client idéal ─────────────────────────────────────────── */}
      <div className="card">
        <h2>Profil client idéal (ICP)</h2>
        <p className="sub small" style={{ marginBottom: 14 }}>
          Définit la cible idéale. Le score Business de chaque prospect est calculé en fonction
          de ces critères (taille, secteur, codes NAF). Laisser vide = pas de filtre.
        </p>

        <div className="grid2">
          <div>
            <label>Effectif minimum</label>
            <input
              type="number"
              min="0"
              step="50"
              value={icp.effectif_min ?? ""}
              placeholder="ex. 250"
              onChange={(e) =>
                setIcp({ ...icp, effectif_min: e.target.value === "" ? null : +e.target.value })
              }
            />
          </div>
          <div>
            <label>Effectif maximum</label>
            <input
              type="number"
              min="0"
              step="1000"
              value={icp.effectif_max ?? ""}
              placeholder="ex. 10000"
              onChange={(e) =>
                setIcp({ ...icp, effectif_max: e.target.value === "" ? null : +e.target.value })
              }
            />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Codes NAF inclus (séparés par virgule)</label>
          <input
            placeholder="Vide = tous — ex. 6201Z, 6420Z, 6419Z, 8610Z"
            value={(icp.naf_inclus || []).join(", ")}
            onChange={(e) =>
              setIcp({
                ...icp,
                naf_inclus: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
              })
            }
          />
          <p className="sub small" style={{ marginTop: 4 }}>
            Finance : 64xx · Assurance : 65xx · Santé : 86xx · Tech/SI : 62xx · Énergie : 35xx
          </p>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Codes NAF exclus</label>
          <input
            placeholder="ex. 9900Z, 0111Z"
            value={(icp.naf_exclus || []).join(", ")}
            onChange={(e) =>
              setIcp({
                ...icp,
                naf_exclus: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
              })
            }
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Secteurs cibles (mots-clés, séparés par virgule)</label>
          <input
            placeholder="ex. banque, assurance, santé, énergie, transport, défense"
            value={(icp.secteurs_inclus || []).join(", ")}
            onChange={(e) =>
              setIcp({
                ...icp,
                secteurs_inclus: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
              })
            }
          />
          <p className="sub small" style={{ marginTop: 4 }}>
            Utilisé dans la recherche LLM pour orienter la qualification des prospects.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Identité expéditeur</h2>
        <div className="grid2">
          <div>
            <label>Nom</label>
            <input
              value={s.sender_name || ""}
              onChange={(e) => setS({ ...s, sender_name: e.target.value })}
            />
          </div>
          <div>
            <label>Poste</label>
            <input
              placeholder="Account Executive"
              value={s.sender_role || ""}
              onChange={(e) => setS({ ...s, sender_role: e.target.value })}
            />
          </div>
          <div>
            <label>Société</label>
            <input
              value={s.sender_company || ""}
              onChange={(e) => setS({ ...s, sender_company: e.target.value })}
            />
          </div>
        </div>
      </div>

      <button className="btn-fox" onClick={save}>
        {saved ? "Enregistré ✓" : "Enregistrer"}
      </button>
    </>
  );
}
