import type { ReactElement } from "react";

// Petit helper JSX-less pour construire des éléments Satori.
// Satori accepte des POJO { type, props: { children, style, ... }, key } et
// ne dépend pas de React. Cette approche évite d'avoir à configurer un
// runtime JSX dans vitest et laisse les templates en .ts (plus rapide à
// typechecker, aucun risque de fuite React).

type Child = unknown;
type Props = Record<string, unknown> | null;

export function h(type: string, props: Props, ...children: Child[]): ReactElement {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  const merged = {
    ...(props ?? {}),
    children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids,
  };
  return { type, props: merged, key: null } as unknown as ReactElement;
}
