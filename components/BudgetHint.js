"use client";

import { useEffect, useState } from "react";
import { Caption1 } from "@fluentui/react-components";
import { fetchJson } from "@/lib/fetch-json";

// Jauge budget IA discrète, affichée près des boutons qui déclenchent un appel
// payant : le plafond ne doit plus se découvrir via une 429 après 30 s
// d'attente. Une seule requête légère (/api/budget) par montage.
export default function BudgetHint() {
  const [b, setB] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchJson("/api/budget").then(({ ok, data }) => {
      if (alive && ok) setB(data);
    });
    return () => { alive = false; };
  }, []);

  if (!b) return null;
  const ratio = b.budget_eur ? b.spent_eur / b.budget_eur : 0;
  const color = b.exceeded ? "#C50F1F" : ratio >= 0.8 ? "#7C5500" : "var(--colorNeutralForeground3)";

  return (
    <Caption1 style={{ color, whiteSpace: "nowrap" }} title="Dépense IA du mois en cours / plafond mensuel">
      IA : {b.spent_eur.toFixed(2)} € / {b.budget_eur} €{b.exceeded ? " — plafond atteint" : ""}
    </Caption1>
  );
}
