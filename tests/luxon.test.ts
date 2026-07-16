import { describe, it, expect } from "vitest";
import { toParis, DateTime } from "@/modules/shared/luxon";

describe("shared/luxon", () => {
  it("converts a UTC instant to Europe/Paris", () => {
    // 2026-07-14 07:00 UTC → 09:00 heure de Paris en été
    const utc = DateTime.fromISO("2026-07-14T07:00:00Z", { zone: "utc" });
    const paris = toParis(utc);
    expect(paris.zoneName).toBe("Europe/Paris");
    expect(paris.hour).toBe(9);
    expect(paris.minute).toBe(0);
  });

  it("gives 09:00 Paris for a 09:00 wall-clock even when server is UTC", () => {
    // Simule un serveur en UTC : quand il est 09:00 heure de Paris,
    // toParis() sur cette même instant doit renvoyer hour === 9.
    // (En hiver : 09:00 Paris = 08:00 UTC. En été : 09:00 Paris = 07:00 UTC.)
    const parisWall = DateTime.fromObject(
      { year: 2026, month: 3, day: 3, hour: 9, minute: 0 },
      { zone: "Europe/Paris" },
    );
    const backToParis = toParis(parisWall.toUTC());
    expect(backToParis.hour).toBe(9);
    expect(backToParis.minute).toBe(0);
  });
});
