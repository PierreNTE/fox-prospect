export function FoxMark({ size = 36 }) {
  return (
    <span
      role="img"
      aria-label="Fox Prospect"
      style={{ fontSize: size, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      🦊
    </span>
  );
}

export function FoxLogo({ size = 36, showWordmark = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <FoxMark size={size} />
      {showWordmark && (
        <span
          style={{
            fontFamily:
              '"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif',
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: "-0.01em",
            lineHeight: 1,
          }}
        >
          Fox <span style={{ color: "#7C3AED" }}>Prospect</span>
        </span>
      )}
    </span>
  );
}
