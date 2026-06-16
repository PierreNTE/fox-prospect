// Identité Fox Prospect : renard géométrique sur tuile indigo→violet.
// FoxMark = la marque seule (favicon/app tile) ; FoxLogo = marque + wordmark.

export function FoxMark({ size = 34, rounded = 8 }) {
  const gid = "foxgrad";
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B53E6" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="132" height="132" rx={rounded * 3.7} fill={`url(#${gid})`} />
      <polygon points="38,38 60,68 34,72" fill="#ffffff" />
      <polygon points="94,38 72,68 98,72" fill="#ffffff" />
      <polygon points="40,36 52,44 36,52" fill="#F6A623" />
      <polygon points="92,36 80,44 96,52" fill="#F6A623" />
      <polygon points="34,64 98,64 66,110" fill="#ffffff" />
      <polygon points="50,72 62,72 56,82" fill="#4F46E5" />
      <polygon points="70,72 82,72 76,82" fill="#4F46E5" />
      <polygon points="60,92 72,92 66,102" fill="#F6A623" />
    </svg>
  );
}

export function FoxLogo({ size = 34, showWordmark = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 11 }}>
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
