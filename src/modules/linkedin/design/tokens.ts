// Source unique de vérité du design system.
// Consommé par Tailwind (via CSS variables déclarées dans app/globals.css)
// ET par Satori (rendu des visuels — §4.5, §9 du CDC-01).
// Ne dupliquer nulle part.

export const colors = {
  bg: "#0B0F14",
  surface: "#121820",
  surface2: "#1A222D",
  border: "#1E2833",

  fg: "#E6EDF3",
  fgMuted: "#8B98A5",

  accent: "#FFB020",
  accentFg: "#0B0F14",

  draft: "#6E7681",
  queued: "#FFB020",
  scheduled: "#58A6FF",
  published: "#3FB950",
  failed: "#F85149",
} as const;

export const fonts = {
  sans: "Geist Sans",
  mono: "JetBrains Mono",
} as const;

export type StatusColor = keyof Pick<
  typeof colors,
  "draft" | "queued" | "scheduled" | "published" | "failed"
>;

export type DesignTokens = {
  colors: typeof colors;
  fonts: typeof fonts;
};

export const tokens: DesignTokens = { colors, fonts };
