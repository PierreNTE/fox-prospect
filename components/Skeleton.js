// Composants squelettes animés — remplacent les spinners pendant le chargement.
// Le shimmer utilise les tokens CSS Fluent pour s'adapter au thème clair/sombre.
export function SkeletonLine({ width = "100%", height = 13, style = {} }) {
  return <span className="sk-line" style={{ width, height, display: "block", ...style }} />;
}

export function SkeletonTableRows({ rows = 7, cols = 5, widths }) {
  const defaultWidths = ["65%", "55%", "50%", "40px", "90px"];
  const w = widths || defaultWidths.slice(0, cols);
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="sk-row">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} style={{ padding: "14px 16px" }}>
          <span className="sk-line" style={{ width: w[j] || "50%", height: 13, display: "block" }} />
        </td>
      ))}
    </tr>
  ));
}

export function SkeletonFunnelCards({ count = 5 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} style={{
      flex: "1 1 100px", minWidth: 90, padding: "12px 14px",
      background: "var(--colorNeutralBackground1)",
      border: "1px solid var(--colorNeutralStroke2)",
      borderRadius: "var(--borderRadiusMedium)",
      borderBottom: "3px solid transparent",
    }}>
      <span className="sk-line" style={{ width: 32, height: 28, display: "block", marginBottom: 8 }} />
      <span className="sk-line" style={{ width: "60%", height: 11 }} />
    </div>
  ));
}

export function SkeletonAccountCards({ count = 4 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} style={{
      padding: "12px 16px",
      background: "var(--colorNeutralBackground1)",
      border: "1px solid var(--colorNeutralStroke2)",
      borderRadius: "var(--borderRadiusMedium)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span className="sk-line" style={{ width: 32, height: 14, display: "block", flexShrink: 0 }} />
        <span className="sk-line" style={{ width: "45%", height: 14 }} />
        <span className="sk-line" style={{ width: "25%", height: 12, marginLeft: "auto" }} />
      </div>
      <span className="sk-line" style={{ width: "75%", height: 11 }} />
    </div>
  ));
}
