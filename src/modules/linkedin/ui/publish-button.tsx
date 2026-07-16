"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  postId: string;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
}

export function PublishButton({ postId, disabled, label = "Publier maintenant", compact }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    if (busy) return;
    if (!window.confirm("Publier ce post maintenant ?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/linkedin/posts/${postId}/publish`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { result?: { outcome: string; url?: string; error?: string } };
      const r = body.result;
      if (!r) {
        setMsg(`Erreur ${res.status}`);
      } else if (r.outcome === "published") {
        setMsg(`✅ Publié — ${r.url ?? ""}`);
        router.refresh();
      } else if (r.outcome === "skipped_dry_run") {
        setMsg("dryRun : payload archivé, aucun appel LinkedIn.");
        router.refresh();
      } else if (r.outcome === "not_connected") {
        setMsg("LinkedIn non connecté (Réglages → Connecter).");
      } else if (r.outcome === "not_publishable") {
        setMsg("Post non publiable dans son état actuel.");
      } else if (r.outcome === "duplicate") {
        setMsg("Doublon détecté (idempotencyKey déjà utilisé).");
      } else {
        setMsg(`Échec : ${r.error ?? "erreur inconnue"}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "inline-flex flex-col items-start gap-1" : "flex flex-col items-start gap-2"}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Publication…" : label}
      </button>
      {msg ? <span className="text-xs text-fg-muted">{msg}</span> : null}
    </div>
  );
}
