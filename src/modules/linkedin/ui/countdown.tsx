"use client";

import { useEffect, useState } from "react";

/** Compte à rebours en `font-mono` vers `targetIso` (UTC ISO string).
 * Le calcul est fait côté client — pas d'affichage de fuseau. */
export function Countdown({ targetIso }: { targetIso: string }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const target = new Date(targetIso).getTime();
    if (Number.isNaN(target)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  const diffMs = new Date(targetIso).getTime() - now;
  if (Number.isNaN(diffMs)) return <span className="font-mono text-fg-muted">—</span>;

  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const seconds = Math.floor((abs % 60000) / 1000);

  const parts = [
    days > 0 ? `${days}j` : null,
    hours > 0 || days > 0 ? `${String(hours).padStart(2, "0")}h` : null,
    `${String(minutes).padStart(2, "0")}m`,
    `${String(seconds).padStart(2, "0")}s`,
  ].filter(Boolean);

  return (
    <div className={`font-mono text-2xl ${past ? "text-status-failed" : "text-fg"}`}>
      {past ? "-" : ""}
      {parts.join(" ")}
    </div>
  );
}
