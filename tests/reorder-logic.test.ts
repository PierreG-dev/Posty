// Le repository post-repo.reorderQueue fait un findMany puis un bulkWrite.
// Ce test valide la LOGIQUE de garde-fou sans monter Mongo : on extrait la
// partie pure (validation des ids fournis vs ids existants) pour la tester.

import { describe, it, expect } from "vitest";

function validateReorder(existing: string[], provided: string[]): { ok: boolean; reason?: string } {
  if (existing.length !== provided.length) {
    return { ok: false, reason: `orderedIds contient ${provided.length} ids, la file en a ${existing.length}` };
  }
  const a = new Set(existing);
  const b = new Set(provided);
  if (a.size !== b.size || [...a].some((id) => !b.has(id))) {
    return { ok: false, reason: "orderedIds ne correspond pas à la file actuelle" };
  }
  return { ok: true };
}

describe("reorder guard", () => {
  it("accepts a proper permutation", () => {
    expect(validateReorder(["a", "b", "c"], ["c", "a", "b"])).toEqual({ ok: true });
  });

  it("rejects when a post is missing", () => {
    const r = validateReorder(["a", "b", "c"], ["a", "b"]);
    expect(r.ok).toBe(false);
  });

  it("rejects when an unknown id sneaks in", () => {
    const r = validateReorder(["a", "b", "c"], ["a", "b", "X"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ne correspond pas/);
  });

  it("rejects when count is off", () => {
    const r = validateReorder(["a", "b"], ["a", "b", "c"]);
    expect(r.ok).toBe(false);
  });

  it("empty file with empty order is OK (noop)", () => {
    expect(validateReorder([], [])).toEqual({ ok: true });
  });
});
