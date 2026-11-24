"use client";

// ZoomInfo (licence Dell) : jamais interrogé automatiquement — ses conditions
// interdisent l'accès robotisé, et ses données restent dans les outils Dell.
// Le bouton copie le nom de la société et ouvre ZoomInfo dans un onglet de ton
// navigateur (session pro) : la recherche reste manuelle (coller + Entrée).
import { useState } from "react";
import { Button } from "@fluentui/react-components";
import { Search24Regular, Checkmark24Regular } from "@fluentui/react-icons";

export default function ZoomInfoButton({ name, size = "small" }) {
  const [ok, setOk] = useState(false);
  return (
    <Button size={size} appearance="outline" icon={ok ? <Checkmark24Regular /> : <Search24Regular />}
      title="Copie le nom de la société et ouvre ZoomInfo : colle-le dans la recherche"
      onClick={async () => {
        try { await navigator.clipboard.writeText(name || ""); setOk(true); setTimeout(() => setOk(false), 2500); } catch {}
        window.open("https://app.zoominfo.com/", "_blank", "noopener,noreferrer");
      }}>
      {ok ? "Nom copié · colle-le" : "ZoomInfo"}
    </Button>
  );
}
