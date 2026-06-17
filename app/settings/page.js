"use client";

import { useEffect, useState } from "react";
import {
  Card,
  Button,
  Input,
  Textarea,
  Title2,
  Body1,
  Caption1,
  Spinner,
} from "@fluentui/react-components";
import {
  Settings24Regular,
  Person24Regular,
  Target24Regular,
  Checkmark24Regular,
  Save24Regular,
} from "@fluentui/react-icons";

const BRAND = "#5B53E6";
const GREEN = "#107C10";
const RED = "#C50F1F";

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setS(d.settings)));
  }, []);

  const save = async () => {
    const res = await fetch("/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    const d = await res.json();
    if (d.error) setError(d.error);
    else { setSaved(true); setTimeout(() => setSaved(false), 1600); }
  };

  if (!s) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
        {error ? <Body1 style={{ color: RED }}>{error}</Body1>
          : <><Spinner size="small" /><Body1 style={{ color: "var(--colorNeutralForeground2)" }}>Chargement…</Body1></>}
      </div>
    );
  }

  const icp = s.icp || {};
  const setIcp = (next) => setS({ ...s, icp: next });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Title2>Réglages</Title2>
        <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
          Le moteur adapte recherche et brouillons à ton offre et à ton identité.
        </Body1>
      </div>

      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {/* ── Mon offre ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Settings24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Mon offre</Body1>
        </div>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 10 }}>
          Description de l'offre — mise à jour le jour où tu signes chez un nouveau constructeur/éditeur.
        </Caption1>
        <Textarea
          placeholder="Ex. : Solutions de cybersécurité réseau (NGFW, SASE, Zero Trust) pour ETI et grands comptes…"
          value={s.offer || ""}
          onChange={(_, d) => setS({ ...s, offer: d.value })}
          rows={5}
          style={{ width: "100%" }}
        />
      </Card>

      {/* ── ICP ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Target24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Profil client idéal (ICP)</Body1>
        </div>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 16 }}>
          Définit la cible idéale. Le score Business est calculé en fonction de ces critères (taille, secteur, NAF). Laisser vide = pas de filtre.
        </Caption1>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Effectif minimum</Caption1>
            <Input
              type="number"
              placeholder="ex. 250"
              value={icp.effectif_min ?? ""}
              onChange={(_, d) => setIcp({ ...icp, effectif_min: d.value === "" ? null : +d.value })}
            />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Effectif maximum</Caption1>
            <Input
              type="number"
              placeholder="ex. 10000"
              value={icp.effectif_max ?? ""}
              onChange={(_, d) => setIcp({ ...icp, effectif_max: d.value === "" ? null : +d.value })}
            />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Codes NAF inclus (séparés par virgule)</Caption1>
          <Input
            placeholder="Vide = tous — ex. 6201Z, 6420Z, 6419Z, 8610Z"
            value={(icp.naf_inclus || []).join(", ")}
            onChange={(_, d) => setIcp({ ...icp, naf_inclus: d.value.split(",").map((x) => x.trim()).filter(Boolean) })}
          />
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>
            Finance : 64xx · Assurance : 65xx · Santé : 86xx · Tech/SI : 62xx · Énergie : 35xx
          </Caption1>
        </div>

        <div style={{ marginBottom: 14 }}>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Codes NAF exclus</Caption1>
          <Input
            placeholder="ex. 9900Z, 0111Z"
            value={(icp.naf_exclus || []).join(", ")}
            onChange={(_, d) => setIcp({ ...icp, naf_exclus: d.value.split(",").map((x) => x.trim()).filter(Boolean) })}
          />
        </div>

        <div>
          <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Secteurs cibles (mots-clés, séparés par virgule)</Caption1>
          <Input
            placeholder="ex. banque, assurance, santé, énergie, transport, défense"
            value={(icp.secteurs_inclus || []).join(", ")}
            onChange={(_, d) => setIcp({ ...icp, secteurs_inclus: d.value.split(",").map((x) => x.trim()).filter(Boolean) })}
          />
          <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>
            Utilisé dans la recherche LLM pour orienter la qualification des prospects.
          </Caption1>
        </div>
      </Card>

      {/* ── Identité expéditeur ── */}
      <Card style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Person24Regular style={{ color: BRAND }} />
          <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Identité expéditeur</Body1>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Nom</Caption1>
            <Input value={s.sender_name || ""} onChange={(_, d) => setS({ ...s, sender_name: d.value })} />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Poste</Caption1>
            <Input placeholder="Account Executive" value={s.sender_role || ""} onChange={(_, d) => setS({ ...s, sender_role: d.value })} />
          </div>
          <div>
            <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Société</Caption1>
            <Input value={s.sender_company || ""} onChange={(_, d) => setS({ ...s, sender_company: d.value })} />
          </div>
        </div>
      </Card>

      {/* ── Save ── */}
      <div>
        <Button
          appearance="primary"
          icon={saved ? <Checkmark24Regular /> : <Save24Regular />}
          onClick={save}
        >
          {saved ? "Enregistré ✓" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}
