import { describe, it, expect } from "vitest";
import { parseTextImport, parseJsonImport } from "@/modules/linkedin/services/post-import";

describe("parseTextImport", () => {
  it("returns empty on empty input", () => {
    expect(parseTextImport("")).toEqual({ drafts: [], errors: [] });
    expect(parseTextImport("   \n  ")).toEqual({ drafts: [], errors: [] });
  });

  it("parses a single block without separator", () => {
    const r = parseTextImport("Bonjour tout le monde");
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]?.content).toBe("Bonjour tout le monde");
  });

  it("splits on isolated --- lines", () => {
    const raw = "post A\n---\npost B\n---\npost C";
    const r = parseTextImport(raw);
    expect(r.drafts.map((d) => d.content)).toEqual(["post A", "post B", "post C"]);
  });

  it("ignores empty blocks between consecutive separators", () => {
    const raw = "A\n---\n---\nB";
    const r = parseTextImport(raw);
    expect(r.drafts.map((d) => d.content)).toEqual(["A", "B"]);
  });

  it("tolerates leading and trailing separators", () => {
    const raw = "---\nA\n---\nB\n---\n";
    const r = parseTextImport(raw);
    expect(r.drafts.map((d) => d.content)).toEqual(["A", "B"]);
  });

  it("tolerates whitespace around ---", () => {
    const raw = "A\n   ---   \nB";
    const r = parseTextImport(raw);
    expect(r.drafts.map((d) => d.content)).toEqual(["A", "B"]);
  });

  it("does NOT split on --- inside a line", () => {
    const raw = "Voici du texte --- avec des tirets\n---\nautre";
    const r = parseTextImport(raw);
    expect(r.drafts.map((d) => d.content)).toEqual(["Voici du texte --- avec des tirets", "autre"]);
  });

  it("flags blocks exceeding 3000 characters", () => {
    const long = "x".repeat(3001);
    const r = parseTextImport(long);
    expect(r.drafts).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/3001/);
  });
});

describe("parseJsonImport", () => {
  it("accepts a single object", () => {
    const raw = JSON.stringify({ content: "hello", hashtags: ["#dev"] });
    const r = parseJsonImport(raw);
    expect(r.errors).toEqual([]);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]?.hashtags).toEqual(["#dev"]);
  });

  it("accepts an array of objects", () => {
    const raw = JSON.stringify([
      { content: "A" },
      { content: "B", firstComment: "→ https://example.com" },
    ]);
    const r = parseJsonImport(raw);
    expect(r.errors).toEqual([]);
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts[1]?.firstComment).toBe("→ https://example.com");
  });

  it("rejects malformed JSON with a clear error", () => {
    const r = parseJsonImport("{ oops");
    expect(r.drafts).toHaveLength(0);
    expect(r.errors[0]?.message).toMatch(/JSON invalide/);
  });

  it("rejects malformed hashtag", () => {
    const raw = JSON.stringify({ content: "A", hashtags: ["dev sans diese"] });
    const r = parseJsonImport(raw);
    expect(r.drafts).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.message).toMatch(/#MotSansEspace/);
  });
});
