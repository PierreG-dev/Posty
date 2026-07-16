import { describe, it, expect } from "vitest";
import { computePreview, tokenize, LINKEDIN_TRUNCATE_AT } from "@/modules/linkedin/services/post-preview";

describe("tokenize", () => {
  it("returns a single text segment when no hashtag", () => {
    expect(tokenize("plain text")).toEqual([{ kind: "text", text: "plain text" }]);
  });
  it("splits hashtags out", () => {
    expect(tokenize("hello #dev and #ai")).toEqual([
      { kind: "text", text: "hello " },
      { kind: "hashtag", text: "#dev" },
      { kind: "text", text: " and " },
      { kind: "hashtag", text: "#ai" },
    ]);
  });
});

describe("computePreview", () => {
  it("does not truncate short single-line content", () => {
    const r = computePreview("hello");
    expect(r.truncated).toBe(false);
    expect(r.visibleLength).toBe(5);
  });

  it("truncates at the first newline when it comes before the length limit", () => {
    const content = "Une accroche courte\n\nLa suite est plus longue mais reste dans les limites.";
    const r = computePreview(content);
    expect(r.truncated).toBe(true);
    expect(r.truncateAt).toBe("Une accroche courte".length);
  });

  it("truncates at the length limit when there is no newline", () => {
    const content = "x".repeat(200);
    const r = computePreview(content);
    expect(r.truncated).toBe(true);
    expect(r.truncateAt).toBeLessThanOrEqual(LINKEDIN_TRUNCATE_AT);
  });

  it("prefers a nearby space to avoid breaking mid-word", () => {
    // On construit un texte de 200 chars avec un espace juste avant la limite
    // pour qu'on privilégie la coupe sur l'espace.
    const content = "word ".repeat(50); // 250 chars, plein d'espaces réguliers
    const r = computePreview(content);
    expect(r.truncated).toBe(true);
    expect(content[r.truncateAt]).toBe(" ");
  });

  it("keeps hashtags in the hidden segments", () => {
    // Contenu volontairement plus long que 140 chars pour forcer la troncature.
    const padding = "Un long paragraphe qui dépasse la limite visible ".repeat(4);
    const content = `${padding}#hashtag1 #hashtag2 #hashtag3`;
    expect(content.length).toBeGreaterThan(140);
    const r = computePreview(content);
    expect(r.truncated).toBe(true);
    const hiddenHashtags = r.hidden.filter((s) => s.kind === "hashtag").map((s) => s.text);
    expect(hiddenHashtags).toContain("#hashtag1");
  });

  it("totalLength matches raw content", () => {
    const content = "un\ndeux\ntrois";
    const r = computePreview(content);
    expect(r.totalLength).toBe(content.length);
  });
});
