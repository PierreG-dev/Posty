import { describe, it, expect } from "vitest";
import { hashPassword, encodeHashForEnv } from "@/modules/shared/auth/password";

describe("shared/auth/password", () => {
  it("hashPassword produces an argon2id PHC string", async () => {
    const phc = await hashPassword("hello");
    expect(phc.startsWith("$argon2id$")).toBe(true);
  });

  it("encodeHashForEnv strips $ / special chars from env value", async () => {
    const phc = await hashPassword("hello");
    const b64 = encodeHashForEnv(phc);
    expect(b64).not.toContain("$");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(phc);
  });
});
