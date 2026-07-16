import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// Prépare l'env AVANT que le module env.ts ne soit importé.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "x".repeat(48);
  process.env.AUTH_PASSWORD_HASH = Buffer.from("$argon2id$stub", "utf8").toString("base64");
  process.env.MONGODB_URI = "mongodb://localhost:27017";
  process.env.MONGODB_DB = "posty_test";
});

describe("shared/crypto/aes", () => {
  it("round-trips a string", async () => {
    const { encrypt, decrypt } = await import("@/modules/shared/crypto/aes");
    const plain = "hello linkedin token";
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(decrypt(enc)).toBe(plain);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { encrypt } = await import("@/modules/shared/crypto/aes");
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });

  it("throws on tampered payload", async () => {
    const { encrypt, decrypt } = await import("@/modules/shared/crypto/aes");
    const enc = encrypt("secret");
    const buf = Buffer.from(enc, "base64");
    // Flip un octet dans le ciphertext
    const midIdx = Math.floor(buf.length / 2);
    const midByte = buf[midIdx] ?? 0;
    buf[midIdx] = midByte ^ 0x01;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });
});
