import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Redondant avec la règle ESLint no-restricted-imports, mais un test de tests
// est plus visible dans le log CI et documente la contrainte.

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("étanchéité inter-modules", () => {
  it("modules/mailing n'importe rien de modules/linkedin", () => {
    const root = path.resolve(__dirname, "../src/modules/mailing");
    const files = walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/from\s+["'][^"']*modules\/linkedin/.test(text)) offenders.push(path.relative(root, f));
    }
    expect(offenders).toEqual([]);
  });

  it("modules/linkedin n'importe rien de modules/mailing", () => {
    const root = path.resolve(__dirname, "../src/modules/linkedin");
    const files = walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/from\s+["'][^"']*modules\/mailing/.test(text)) offenders.push(path.relative(root, f));
    }
    expect(offenders).toEqual([]);
  });
});
