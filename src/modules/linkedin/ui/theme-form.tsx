"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Input,
  Textarea,
  Select,
  Field,
  Checkbox,
  Alert,
  Card,
  Dialog,
  Badge,
} from "@/modules/shared/ui/primitives";
import { HOOK_PATTERNS, VISUAL_MODES, type ThemeInput, type Theme } from "@/modules/linkedin/domain/theme";
import { LinkedInPostPreview } from "./linkedin-post-preview";
import { Trash2, Plus, Sparkles, Clipboard, ClipboardCheck } from "lucide-react";

interface Props {
  mode: "create" | "edit";
  initial?: Theme;
}

type FormState = {
  name: string;
  slug: string;
  color: string;
  emoji: string;
  description: string;
  aiEnabled: boolean;
  systemPrompt: string;
  structure: string;
  targetLengthMode: "derived" | "fixed";
  targetLength: string;
  hookPatterns: string[];
  examples: string[];
  forbiddenPhrases: string[];
  visualMode: string;
  templateId: string;
  carouselSlides: number;
  defaultHashtags: string;
  active: boolean;
};

function toState(initial?: Theme): FormState {
  return {
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    color: initial?.color ?? "#FFB020",
    emoji: initial?.emoji ?? "",
    description: initial?.description ?? "",
    aiEnabled: initial?.ai.enabled ?? true,
    systemPrompt: initial?.ai.systemPrompt ?? "",
    structure: initial?.ai.structure ?? "",
    targetLengthMode: initial?.ai.targetLength ? "fixed" : "derived",
    targetLength: initial?.ai.targetLength ? String(initial.ai.targetLength) : "1000",
    hookPatterns: [...(initial?.ai.hookPatterns ?? [])],
    examples: initial?.ai.examples.length ? [...initial.ai.examples] : [""],
    forbiddenPhrases: initial?.ai.forbiddenPhrases.length ? [...initial.ai.forbiddenPhrases] : [""],
    visualMode: initial?.visual.mode ?? "none",
    templateId: initial?.visual.templateId ?? "",
    carouselSlides: initial?.visual.carouselSlides ?? 5,
    defaultHashtags: (initial?.defaultHashtags ?? []).join(" "),
    active: initial?.active ?? true,
  };
}

function toPayload(s: FormState): ThemeInput {
  const targetLength =
    s.targetLengthMode === "derived" ? null : Math.max(1, Number(s.targetLength) || 0);
  return {
    name: s.name,
    slug: s.slug.trim() ? s.slug.trim() : undefined,
    color: s.color,
    emoji: s.emoji,
    description: s.description,
    ai: {
      enabled: s.aiEnabled,
      systemPrompt: s.systemPrompt,
      structure: s.structure,
      targetLength,
      hookPatterns: s.hookPatterns.filter((h) =>
        (HOOK_PATTERNS as readonly string[]).includes(h),
      ) as ThemeInput["ai"]["hookPatterns"],
      examples: s.examples.map((e) => e.trim()).filter(Boolean),
      forbiddenPhrases: s.forbiddenPhrases.map((f) => f.trim()).filter(Boolean),
    },
    visual: {
      mode: s.visualMode as ThemeInput["visual"]["mode"],
      templateId: s.templateId.trim() ? s.templateId.trim() : null,
      carouselSlides: s.carouselSlides,
    },
    defaultHashtags: s.defaultHashtags
      .split(/\s+/)
      .map((h) => h.trim())
      .filter(Boolean),
    active: s.active,
  };
}

export function ThemeForm({ mode, initial }: Props) {
  const router = useRouter();
  const [s, setS] = React.useState<FormState>(() => toState(initial));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const noExamples = s.examples.filter((e) => e.trim()).length === 0;

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  function toggleHook(pattern: string) {
    setS((prev) => ({
      ...prev,
      hookPatterns: prev.hookPatterns.includes(pattern)
        ? prev.hookPatterns.filter((p) => p !== pattern)
        : [...prev.hookPatterns, pattern],
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const url = mode === "create" ? "/api/linkedin/themes" : `/api/linkedin/themes/${initial?._id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPayload(s)),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur HTTP ${res.status}`);
      }
      router.push("/linkedin/themes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(`Supprimer le thème "${initial.name}" ? (les posts qui l'utilisent le perdront)`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/linkedin/themes/${initial._id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push("/linkedin/themes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-3xl">
      {noExamples ? (
        <Alert tone="warning">
          <strong>Ce thème n'a aucun exemple de post.</strong> Les exemples déterminent 80 % de la qualité
          de la génération. Ajoute au moins deux posts que tu considères représentatifs de ce que tu veux
          publier — même vieux, même imparfaits.
        </Alert>
      ) : null}

      {/* --- Identité ------------------------------------------------------- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">Identité</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Nom" className="md:col-span-2">
            <Input value={s.name} onChange={(e) => set("name", e.target.value)} required maxLength={60} placeholder="Pédagogie DWWM" />
          </Field>
          <Field label="Emoji" hint="Optionnel, 1 caractère">
            <Input value={s.emoji} onChange={(e) => set("emoji", e.target.value)} maxLength={4} placeholder="📚" />
          </Field>
          <Field label="Couleur" hint="Hex #RRGGBB">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={s.color}
                onChange={(e) => set("color", e.target.value)}
                className="w-10 h-10 rounded-md border border-border cursor-pointer bg-surface-2"
              />
              <Input value={s.color} onChange={(e) => set("color", e.target.value)} pattern="#[0-9A-Fa-f]{6}" />
            </div>
          </Field>
          <Field label="Slug (URL)" hint="Auto depuis le nom si vide" className="md:col-span-2">
            <Input value={s.slug} onChange={(e) => set("slug", e.target.value)} placeholder="pedagogie-dwwm" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={s.description} onChange={(e) => set("description", e.target.value)} maxLength={240} rows={2} placeholder="Retours de terrain sur le titre DWWM." />
        </Field>
      </Card>

      {/* --- IA ------------------------------------------------------------- */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">Génération IA</h2>
          <Checkbox label="Génération activée" checked={s.aiEnabled} onChange={(e) => set("aiEnabled", e.target.checked)} />
        </div>

        <Field label="System prompt" hint="Posture, angle, interdits propres au thème">
          <Textarea rows={5} value={s.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} placeholder="Tu écris pour des développeurs juniors qui préparent le DWWM. Ton praticien, jamais gourou. Anecdotes de session préférées aux généralités." />
        </Field>

        <Field label="Structure" hint="ex : Hook / contexte / 3 points / CTA">
          <Input value={s.structure} onChange={(e) => set("structure", e.target.value)} placeholder="Hook / contexte / 3 points / CTA" />
        </Field>

        <Field label="Longueur cible">
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <Checkbox
                label="Dérivée du média (recommandé)"
                checked={s.targetLengthMode === "derived"}
                onChange={(e) => set("targetLengthMode", e.target.checked ? "derived" : "fixed")}
              />
            </div>
            {s.targetLengthMode === "fixed" ? (
              <Input
                type="number"
                min={100}
                max={3000}
                value={s.targetLength}
                onChange={(e) => set("targetLength", e.target.value)}
                className="max-w-[120px]"
              />
            ) : (
              <p className="text-xs text-fg-muted font-mono">
                texte seul → 900-1500 · + image → 600-1000 · carrousel → 300-600
              </p>
            )}
          </div>
        </Field>

        <Field label="Patterns de hook autorisés" hint="Le générateur (lot 5) piochera dans cette liste">
          <div className="grid grid-cols-2 gap-2">
            {HOOK_PATTERNS.map((h) => (
              <Checkbox key={h} label={<span className="font-mono text-xs">{h}</span>} checked={s.hookPatterns.includes(h)} onChange={() => toggleHook(h)} />
            ))}
          </div>
        </Field>

        <Field label="Exemples few-shot" hint="Le levier qualité #1. Colle 2 ou 3 posts qui te ressemblent.">
          <RepeaterTextarea values={s.examples} onChange={(v) => set("examples", v)} rows={4} placeholder="Colle un post représentatif ici…" />
        </Field>

        <Field label="Formulations interdites" hint="Rejetées par le validateur au lot 5">
          <RepeaterTextarea values={s.forbiddenPhrases} onChange={(v) => set("forbiddenPhrases", v)} rows={2} placeholder='ex: "voici 5 astuces"' />
        </Field>
      </Card>

      {/* --- Visuel --------------------------------------------------------- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">Visuel par défaut</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Mode">
            <Select value={s.visualMode} onChange={(e) => set("visualMode", e.target.value)}>
              {VISUAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Template" hint="Registry au lot 6" className="md:col-span-2">
            <Input value={s.templateId} onChange={(e) => set("templateId", e.target.value)} placeholder="code-card, quote…" disabled={s.visualMode === "none"} />
          </Field>
          {s.visualMode === "carousel" ? (
            <Field label="Nombre de slides" hint="3 à 10">
              <Input type="number" min={3} max={10} value={s.carouselSlides} onChange={(e) => set("carouselSlides", Number(e.target.value))} />
            </Field>
          ) : null}
        </div>
      </Card>

      {/* --- Divers --------------------------------------------------------- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">Hashtags & état</h2>
        <Field label="Hashtags par défaut" hint="Séparés par des espaces. Format : #MotSansEspace">
          <Input value={s.defaultHashtags} onChange={(e) => set("defaultHashtags", e.target.value)} placeholder="#dev #formation #cda" />
        </Field>
        <Checkbox label="Thème actif" checked={s.active} onChange={(e) => set("active", e.target.checked)} />
      </Card>

      {mode === "edit" && initial ? <PromptToolbox theme={initial} /> : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex items-center justify-between">
        {mode === "edit" ? (
          <Button type="button" variant="danger" onClick={onDelete} disabled={saving}>
            <Trash2 size={14} strokeWidth={1.5} />
            Supprimer
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => router.push("/linkedin/themes")} disabled={saving}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !s.name.trim()}>
            {saving ? "Enregistrement…" : mode === "create" ? "Créer le thème" : "Enregistrer"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PromptToolbox — §12 « Tester la génération » + §8.9 « Copier le prompt ».
// Isolé du form principal pour ne pas coupler ses re-renders.
// ─────────────────────────────────────────────────────────────────────────────

interface VariantSerialized {
  ok: boolean;
  post?: { content: string; hashtags: string[]; firstComment: string | null };
  errors?: Array<{ path: string; message: string }>;
  warnings?: Array<{ path: string; message: string }>;
}
interface TestGenResult {
  variants: VariantSerialized[];
}

function PromptToolbox({ theme }: { theme: Theme }) {
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestGenResult | null>(null);
  const [testError, setTestError] = React.useState<string | null>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "full" | "schema">("idle");
  const [copying, setCopying] = React.useState(false);

  async function runTest() {
    setTestError(null);
    setTestResult(null);
    setTesting(true);
    try {
      const res = await fetch(`/api/linkedin/themes/${theme._id}/test-generation`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setTestResult((await res.json()) as TestGenResult);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function copyPrompt(which: "full" | "schema") {
    setCopying(true);
    try {
      const res = await fetch(`/api/linkedin/themes/${theme._id}/prompt`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { full: string; schemaOnly: string };
      const text = which === "full" ? body.full : body.schemaOnly;
      await navigator.clipboard.writeText(text);
      setCopyState(which);
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setCopying(false);
    }
  }

  const firstVariant = testResult?.variants[0];

  return (
    <>
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">
            Boîte à outils IA
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant="secondary" onClick={runTest} disabled={testing}>
              <Sparkles size={14} strokeWidth={1.5} />
              {testing ? "Génération…" : "Tester la génération"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => copyPrompt("full")} disabled={copying}>
              {copyState === "full" ? (
                <ClipboardCheck size={14} strokeWidth={1.5} />
              ) : (
                <Clipboard size={14} strokeWidth={1.5} />
              )}
              Copier le prompt complet
            </Button>
            <Button type="button" variant="ghost" onClick={() => copyPrompt("schema")} disabled={copying}>
              {copyState === "schema" ? (
                <ClipboardCheck size={14} strokeWidth={1.5} />
              ) : (
                <Clipboard size={14} strokeWidth={1.5} />
              )}
              Copier le schéma seul
            </Button>
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          « Tester la génération » ne persiste rien. « Copier le prompt » produit un bloc autonome, à coller
          dans n'importe quel chat LLM → le JSON obtenu passe le validateur (onglet Importer, thème sélectionné).
        </p>
      </Card>

      <Dialog
        open={testResult !== null || testError !== null}
        onClose={() => {
          setTestResult(null);
          setTestError(null);
        }}
        title="Test de génération"
      >
        {testError ? (
          <Alert tone="danger">{testError}</Alert>
        ) : firstVariant ? (
          <div className="space-y-3">
            {firstVariant.ok && firstVariant.post ? (
              <>
                <LinkedInPostPreview
                  content={firstVariant.post.content}
                  hashtags={firstVariant.post.hashtags}
                  firstComment={firstVariant.post.firstComment}
                  showCounter
                />
                {firstVariant.warnings && firstVariant.warnings.length > 0 ? (
                  <Alert tone="warning">
                    {firstVariant.warnings.map((w, i) => (
                      <div key={i} className="text-xs font-mono">
                        {w.path} : {w.message}
                      </div>
                    ))}
                  </Alert>
                ) : (
                  <Badge tone="published">Validé sans avertissement</Badge>
                )}
              </>
            ) : (
              <Alert tone="danger">
                <p className="font-semibold text-xs mb-1">Rejetée par le validateur :</p>
                <ul className="text-xs font-mono space-y-0.5">
                  {firstVariant.errors?.map((e, i) => (
                    <li key={i}>
                      {e.path} : {e.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

// Petit repeater générique.
function RepeaterTextarea({
  values,
  onChange,
  rows,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  rows: number;
  placeholder?: string;
}) {
  function setAt(i: number, v: string) {
    const copy = [...values];
    copy[i] = v;
    onChange(copy);
  }
  function remove(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...values, ""]);
  }
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <Textarea rows={rows} value={v} onChange={(e) => setAt(i, e.target.value)} placeholder={placeholder} className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} className="mt-1" aria-label="Retirer">
            <Trash2 size={14} strokeWidth={1.5} />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={add}>
        <Plus size={14} strokeWidth={1.5} />
        Ajouter
      </Button>
    </div>
  );
}
