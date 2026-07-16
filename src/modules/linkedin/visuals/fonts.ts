import { promises as fs } from "node:fs";
import path from "node:path";

// CDC-01 §4.5, §9 — polices utilisées à la fois par l'UI (via CSS) et par
// Satori (via buffers). Fichiers .ttf commités dans public/fonts/ (choix
// tranché au lot 6 : ~800 Ko une fois pour toutes, versus un script de
// download au boot qui casse en CI).

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

let cached: SatoriFont[] | null = null;

function fontsDir(): string {
  return path.join(process.cwd(), "public", "fonts");
}

export async function loadFonts(): Promise<SatoriFont[]> {
  if (cached) return cached;
  const dir = fontsDir();
  const [sansReg, sansBold, monoReg, monoBold] = await Promise.all([
    fs.readFile(path.join(dir, "GeistSans-Regular.ttf")),
    fs.readFile(path.join(dir, "GeistSans-Bold.ttf")),
    fs.readFile(path.join(dir, "JetBrainsMono-Regular.ttf")),
    fs.readFile(path.join(dir, "JetBrainsMono-Bold.ttf")),
  ]);
  cached = [
    { name: "Geist Sans", data: sansReg, weight: 400, style: "normal" },
    { name: "Geist Sans", data: sansBold, weight: 700, style: "normal" },
    { name: "JetBrains Mono", data: monoReg, weight: 400, style: "normal" },
    { name: "JetBrains Mono", data: monoBold, weight: 700, style: "normal" },
  ];
  return cached;
}

/** Test-only : purge le cache (utile si un test remplace les fichiers). */
export function _resetFontsCache(): void {
  cached = null;
}
