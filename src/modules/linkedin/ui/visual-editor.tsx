"use client";

import * as React from "react";
import { Button, Textarea, Select, Field, Alert, Card } from "@/modules/shared/ui/primitives";
import type { VisualMode } from "@/modules/linkedin/domain/theme";

// CDC-01 §9.5 — édition et prévisualisation d'un visuel avant mise en file.
// Monté par PostEditor quand `theme.visual.mode !== 'none'`.
// Le formulaire est GÉNÉRIQUE : quelques champs stringifiés (l'utilisateur
// tape du JSON pour `params`). C'est intentionnel — un formulaire dynamique
// par template ferait doubler ce fichier sans améliorer l'usage réel (je
// génère principalement via l'IA, ce panneau sert au tuning ponctuel).

interface TemplateInfo {
  id: string;
  label: string;
  kind: "post" | "slide" | "both";
  promptHint: string;
}

interface Props {
  mode: Exclude<VisualMode, "none">;
  initialTemplateId?: string | null;
  initialParams?: unknown;
  /** Appelé quand l'utilisateur clique "Attacher au post" et que la
   *  persistance a réussi. La sélection de média est propagée à PostEditor. */
  onAttach: (result: { assetId: string; kind: "image" | "document" }) => void;
}

export function VisualEditor({ mode, initialTemplateId, initialParams, onAttach }: Props) {
  const [templates, setTemplates] = React.useState<TemplateInfo[]>([]);
  const [templateId, setTemplateId] = React.useState<string>(initialTemplateId ?? "");
  const [paramsText, setParamsText] = React.useState<string>(
    initialParams ? JSON.stringify(initialParams, null, 2) : "{}",
  );
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "attach" | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/linkedin/visuals/templates?mode=${mode}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setTemplates(j.templates ?? []);
        if (!templateId && j.templates?.[0]) setTemplateId(j.templates[0].id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, templateId]);

  function parseParams(): unknown {
    try {
      return JSON.parse(paramsText);
    } catch (e) {
      throw new Error(`JSON invalide dans params : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function onPreview() {
    setError(null);
    setBusy("preview");
    try {
      const params = parseParams();
      const res = await fetch("/api/linkedin/visuals/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "image", templateId, params }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onAttachClick() {
    setError(null);
    setBusy("attach");
    try {
      const params = parseParams();
      const res = await fetch("/api/linkedin/visuals/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "image", templateId, params }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      onAttach({ assetId: j.assetId, kind: j.kind });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const currentTemplate = templates.find((t) => t.id === templateId);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono uppercase tracking-wider text-fg-muted">
          Visuel — mode « {mode} »
        </h3>
      </div>

      <Field label="Template">
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">— choisir —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      {currentTemplate ? (
        <p className="text-xs text-fg-muted">{currentTemplate.promptHint}</p>
      ) : null}

      <Field label="Params (JSON)" hint="Le schéma du template rejette les dépassements de caractères.">
        <Textarea
          value={paramsText}
          onChange={(e) => setParamsText(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          spellCheck={false}
        />
      </Field>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" onClick={onPreview} disabled={busy !== null || !templateId}>
          {busy === "preview" ? "Rendu…" : "Prévisualiser"}
        </Button>
        <Button type="button" variant="primary" onClick={onAttachClick} disabled={busy !== null || !templateId}>
          {busy === "attach" ? "Attachement…" : "Attacher au post"}
        </Button>
      </div>

      {previewUrl ? (
        <div className="pt-2">
          <p className="text-xs font-mono uppercase tracking-wider text-fg-muted mb-2">Aperçu</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Aperçu" className="w-full rounded-md border border-border" />
        </div>
      ) : null}
    </Card>
  );
}

