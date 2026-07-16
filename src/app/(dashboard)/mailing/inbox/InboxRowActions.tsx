"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/modules/shared/ui/primitives";

export function InboxRowActions({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "promote" | "resume">(null);
  const [error, setError] = useState<string | null>(null);

  async function call(kind: "promote" | "resume") {
    setBusy(kind);
    setError(null);
    try {
      const r = await fetch(`/api/mailing/inbox/${encodeURIComponent(companyId)}/${kind}`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-failed">{error}</span> : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={busy !== null}
        onClick={() => void call("resume")}
      >
        {busy === "resume" ? "…" : "Reprendre la séquence"}
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={busy !== null}
        onClick={() => void call("promote")}
      >
        {busy === "promote" ? "…" : "Passer en CLIENT dans Twenty"}
      </Button>
    </div>
  );
}
