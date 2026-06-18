// Identité Fox Prospect — tête de renard illustrée (style mascotte premium).
// Formes lisses (courbes de Bézier) + dégradés pour un rendu "dessiné", pas
// "triangles bout à bout". FoxMark = la marque seule ; FoxLogo = marque + texte.
//
// Les ids de dégradé sont fixes : plusieurs SVG identiques sur la page résolvent
// tous url(#…) vers la 1re définition (identique), donc aucun conflit visuel.

export function FoxMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="foxFur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F79C42" />
          <stop offset="100%" stopColor="#E06A22" />
        </linearGradient>
        <linearGradient id="foxFurDark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8772A" />
          <stop offset="100%" stopColor="#C9521A" />
        </linearGradient>
      </defs>

      {/* Oreilles (arrière, plus foncées) */}
      <path d="M24 40 C18 26 16 15 19 11 C29 14 39 24 45 36 C37 33 29 35 24 40 Z" fill="url(#foxFurDark)" />
      <path d="M76 40 C82 26 84 15 81 11 C71 14 61 24 55 36 C63 33 71 35 76 40 Z" fill="url(#foxFurDark)" />

      {/* Intérieur des oreilles (crème) */}
      <path d="M27 37 C23 27 22 19 24 16 C31 19 38 27 42 36 C37 34 31 34 27 37 Z" fill="#FFF1E0" />
      <path d="M73 37 C77 27 78 19 76 16 C69 19 62 27 58 36 C63 34 69 34 73 37 Z" fill="#FFF1E0" />

      {/* Tête (face avant) */}
      <path d="M50 30 C33 30 22 43 23 58 C24 73 36 86 50 93 C64 86 76 73 77 58 C78 43 67 30 50 30 Z" fill="url(#foxFur)" />

      {/* Joues / museau (crème) — haut */}
      <path d="M50 41 C43 53 39 62 40 70 C45 75 55 75 60 70 C61 62 57 53 50 41 Z" fill="#FFF6EC" />
      {/* Menton (crème) — bas */}
      <path d="M40 70 C42 80 46 88 50 93 C54 88 58 80 60 70 C55 74 45 74 40 70 Z" fill="#FFF6EC" />

      {/* Yeux */}
      <ellipse cx="37.5" cy="55" rx="5" ry="6" fill="#2A2438" />
      <ellipse cx="62.5" cy="55" rx="5" ry="6" fill="#2A2438" />
      <circle cx="39.3" cy="52.8" r="1.5" fill="#fff" />
      <circle cx="64.3" cy="52.8" r="1.5" fill="#fff" />

      {/* Truffe */}
      <path d="M50 69 C46 69 43 71 44 74 C45 77 48 78 50 78 C52 78 55 77 56 74 C57 71 54 69 50 69 Z" fill="#2A2438" />
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
