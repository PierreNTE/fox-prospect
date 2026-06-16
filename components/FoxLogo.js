// Identité Fox Prospect — illustration plate d'une tête de renard (style mascotte
// premium). FoxMark = la marque seule ; FoxLogo = marque + wordmark.

export function FoxMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M24 9 L47 41 L11 38 Z" fill="#C9591A" />
      <path d="M76 9 L53 41 L89 38 Z" fill="#C9591A" />
      <path d="M50 27 C33 27 19 33 18 48 C17 62 31 79 50 90 C69 79 83 62 82 48 C81 33 67 27 50 27 Z" fill="#EE7A2E" />
      <path d="M28 15 L43 39 L19 36 Z" fill="#FFF4E8" />
      <path d="M72 15 L57 39 L81 36 Z" fill="#FFF4E8" />
      <path d="M24 9 L31 19 L19 17 Z" fill="#2A2438" />
      <path d="M76 9 L69 19 L81 17 Z" fill="#2A2438" />
      <path d="M50 36 C44 46 40 52 39 58 C44 62 56 62 61 58 C60 52 56 46 50 36 Z" fill="#FFF4E8" />
      <path d="M39 58 C40 70 45 82 50 90 C55 82 60 70 61 58 C56 63 44 63 39 58 Z" fill="#FFF4E8" />
      <ellipse cx="36" cy="50" rx="5.2" ry="3.6" fill="#2A2438" transform="rotate(-14 36 50)" />
      <ellipse cx="64" cy="50" rx="5.2" ry="3.6" fill="#2A2438" transform="rotate(14 64 50)" />
      <circle cx="37.6" cy="48.8" r="1.2" fill="#fff" />
      <circle cx="65.6" cy="48.8" r="1.2" fill="#fff" />
      <path d="M50 62 C46 62 43 64 44 67 C45 70 48 71 50 71 C52 71 55 70 56 67 C57 64 54 62 50 62 Z" fill="#2A2438" />
    </svg>
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
