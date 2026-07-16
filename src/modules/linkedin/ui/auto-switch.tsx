"use client";

import { useState, useTransition } from "react";

export function AutoSwitch({ initial }: { initial: boolean }) {
  const [auto, setAuto] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !auto;
    setAuto(next);
    startTransition(async () => {
      const r = await fetch("/api/linkedin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoGeneration: next }),
      });
      if (!r.ok) setAuto(!next); // rollback
    });
  }

  return (
    <div className="flex items-center gap-3 bg-surface-2 border border-border rounded-lg px-3 py-2">
      <span className="text-xs text-fg-muted font-mono uppercase tracking-wider">Mode</span>
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className={`relative w-32 h-8 rounded-md border border-border font-mono text-xs uppercase tracking-wider transition ${
          auto ? "bg-scheduled/20 text-scheduled" : "bg-queued/20 text-queued"
        }`}
      >
        {auto ? "Auto (IA)" : "File"}
      </button>
    </div>
  );
}
