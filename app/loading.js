// Affiché instantanément (streaming) pendant que le composant serveur charge les
// données → jamais d'écran blanc, même sur un démarrage à froid serverless.
export default function Loading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 64, gap: 12, color: "var(--colorNeutralForeground2)" }}>
      <span style={{ width: 18, height: 18, border: "2px solid var(--colorNeutralStroke2)", borderTopColor: "#5B53E6", borderRadius: "50%", display: "inline-block", animation: "fp-spin 0.7s linear infinite" }} />
      Chargement…
      <style>{"@keyframes fp-spin { to { transform: rotate(360deg) } }"}</style>
    </div>
  );
}
