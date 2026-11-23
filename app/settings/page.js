"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input, Title2, Body1, Caption1, Spinner } from "@fluentui/react-components";
import { Person24Regular, Checkmark24Regular, Save24Regular } from "@fluentui/react-icons";

const BRAND = "#5B53E6";
const RED = "#C50F1F";

// Réglages réduits à l'essentiel : ton nom et ton poste, utilisés pour signer
// les emails et te présenter dans le script d'appel des fiches.
export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setS(d.settings)))
      .catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setError("");
    const res = await fetch("/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    const d = await res.json();
    if (d.error) setError(d.error);
    else { setSaved(true); setTimeout(() => setSaved(false), 1600); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>
      <div>
        <Title2>Réglages</Title2>
        <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
          Ton nom et ton poste servent à signer les emails et à te présenter dans le script d'appel.
        </Body1>
      </div>

      {error && (
        <Card style={{ borderLeft: `3px solid ${RED}`, padding: "12px 16px" }}>
          <Body1 style={{ color: RED }}>{error}</Body1>
        </Card>
      )}

      {!s ? (
        !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 24 }}>
            <Spinner size="small" /><Body1 style={{ color: "var(--colorNeutralForeground2)" }}>Chargement…</Body1>
          </div>
        )
      ) : (
        <>
          <Card style={{ padding: "20px 20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Person24Regular style={{ color: BRAND }} />
              <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Mon identité</Body1>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Prénom et nom</Caption1>
                <Input value={s.sender_name || ""} onChange={(_, d) => setS({ ...s, sender_name: d.value })} />
              </div>
              <div>
                <Caption1 style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Poste</Caption1>
                <Input placeholder="Account Executive" value={s.sender_role || ""} onChange={(_, d) => setS({ ...s, sender_role: d.value })} />
              </div>
            </div>
            <Caption1 style={{ display: "block", marginTop: 10, color: "var(--colorNeutralForeground3)" }}>
              Les fiches déjà prêtes prennent le nouveau nom à leur prochaine mise à jour.
            </Caption1>
          </Card>
          <div>
            <Button appearance="primary" icon={saved ? <Checkmark24Regular /> : <Save24Regular />} onClick={save}>
              {saved ? "Enregistré" : "Enregistrer"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
