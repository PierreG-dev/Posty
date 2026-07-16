import type { Theme } from "./theme";
import type { VisualMode } from "./theme";

// CDC-01 §8.3 — dérivation de la longueur cible en fonction du média.
export interface LengthRange {
  min: number;
  max: number;
}

const DERIVED: Record<VisualMode, LengthRange> = {
  none: { min: 900, max: 1500 },
  image: { min: 600, max: 1000 },
  carousel: { min: 300, max: 600 },
};

/**
 * Renvoie la fourchette [min, max] de caractères attendue pour un thème.
 * - `theme.ai.targetLength` explicite → ±20 % autour de la valeur.
 * - Sinon → dérivé de `theme.visual.mode` (§8.3).
 */
export function deriveTargetLength(theme: Theme): LengthRange {
  const explicit = theme.ai.targetLength;
  if (explicit && explicit > 0) {
    const slack = Math.round(explicit * 0.2);
    return { min: Math.max(1, explicit - slack), max: explicit + slack };
  }
  return DERIVED[theme.visual.mode];
}
