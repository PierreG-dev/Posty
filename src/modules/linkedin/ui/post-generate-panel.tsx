"use client";

import * as React from "react";
import { Button, Select, Field, Alert, Card, Badge } from "@/modules/shared/ui/primitives";
import { LinkedInPostPreview } from "./linkedin-post-preview";
import type { Theme } from "@/modules/linkedin/domain/theme";
import { Sparkles, RefreshCw } from "lucide-react";

// UI serialisation of generator.GenerationResult — libre à répliquer ici pour
// éviter l'import RSC ↔ client des types génération.
interface UiValidationErr {
  path: string;
  message: string;
  severity: "error" | "warning";
}
interface UiVariantOk {
  ok: true;
  post: {
    content: string;
    hashtags: string[];
    firstComment: string | null;
    altText: string;
  };
  warnings: UiValidationErr[];
  attempts: number;
}
interface UiVariantErr {
  ok: false;
  errors: UiValidationErr[];
  warnings: UiValidationErr[];
  attempts: number;
}
type UiVariant = UiVariantOk | UiVariantErr;

interface UiResult {
  themeId: string;
  variants: UiVariant[];
}

interface Props {
  themes: Theme[];
  /** Injecté par le parent pour basculer vers l'onglet Écrire avec le contenu pré-rempli. */
  onUseVariant?: (data: {
    themeId: string;
    content: string;
    hashtags: string[];
    firstComment: string | null;
    altText: string;
  }) => void;
}

export function PostGeneratePanel({ themes, onUseVariant }: Props) {
  const activeThemes = themes.filter((t) => t.active);
  const [themeId, setThemeId] = React.useState<string>(activeThemes[0]?._id ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<UiResult | null>(null);

  async function generate() {
    if (!themeId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/linkedin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId, variants: 3, persist: false }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setResult((await res.json()) as UiResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const currentTheme = themes.find((t) => t._id === themeId);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Thème" className="min-w-[240px]">
            <Select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
              {activeThemes.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.emoji ? `${t.emoji} ` : ""}
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="button"
            variant="primary"
            onClick={generate}
            disabled={!themeId || loading}
          >
            <Sparkles size={14} strokeWidth={1.5} />
            {loading ? "Génération…" : "Générer 3 variantes"}
          </Button>
          {result ? (
            <Button type="button" variant="ghost" onClick={generate} disabled={loading}>
              <RefreshCw size={14} strokeWidth={1.5} />
              Régénérer
            </Button>
          ) : null}
        </div>
        {currentTheme && currentTheme.ai.examples.length === 0 ? (
          <Alert tone="warning" className="mt-3">
            Ce thème n'a aucun exemple few-shot. La qualité de sortie va être médiocre.
          </Alert>
        ) : null}
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {result ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {result.variants.map((v, i) => (
            <VariantCard
              key={i}
              index={i}
              variant={v}
              themeId={themeId}
              onUse={onUseVariant}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VariantCard({
  index,
  variant,
  themeId,
  onUse,
}: {
  index: number;
  variant: UiVariant;
  themeId: string;
  onUse?: Props["onUseVariant"];
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono uppercase tracking-wider text-fg-muted">
          Variante {index + 1}
        </span>
        {variant.attempts > 1 ? (
          <Badge tone="neutral">retry ×{variant.attempts - 1}</Badge>
        ) : null}
      </div>

      {variant.ok ? (
        <>
          <LinkedInPostPreview
            content={variant.post.content}
            hashtags={variant.post.hashtags}
            firstComment={variant.post.firstComment}
            showCounter
          />
          {variant.warnings.length > 0 ? (
            <Alert tone="warning">
              {variant.warnings.map((w, i) => (
                <div key={i} className="text-xs font-mono">
                  {w.path} : {w.message}
                </div>
              ))}
            </Alert>
          ) : null}
          <Button
            type="button"
            variant="primary"
            className="w-full"
            onClick={() =>
              onUse?.({
                themeId,
                content: variant.post.content,
                hashtags: variant.post.hashtags,
                firstComment: variant.post.firstComment,
                altText: variant.post.altText,
              })
            }
          >
            Utiliser celle-ci
          </Button>
        </>
      ) : (
        <Alert tone="danger">
          <p className="font-semibold text-xs mb-1">Rejetée par le validateur :</p>
          <ul className="text-xs font-mono space-y-0.5">
            {variant.errors.map((e, i) => (
              <li key={i}>
                {e.path} : {e.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </Card>
  );
}
