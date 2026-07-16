"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea, Select, Field, Alert, Card } from "@/modules/shared/ui/primitives";
import { LinkedInPostPreview } from "./linkedin-post-preview";
import { VisualEditor } from "./visual-editor";
import type { Post } from "@/modules/linkedin/domain/post";
import type { Theme } from "@/modules/linkedin/domain/theme";
import { POST_CONTENT_MAX } from "@/modules/linkedin/domain/post";

interface Seed {
  themeId?: string | null;
  content?: string;
  hashtags?: string[];
  firstComment?: string | null;
}

interface Props {
  mode: "create" | "edit";
  themes: Theme[];
  initial?: Post;
  /** Pré-remplissage en mode create (utilisé par l'onglet Générer). */
  seed?: Seed;
}

type Destination = "draft" | "queued" | "scheduled";

export function PostEditor({ mode, themes, initial, seed }: Props) {
  const router = useRouter();
  const [content, setContent] = React.useState(initial?.content ?? seed?.content ?? "");
  const [hashtags, setHashtags] = React.useState(
    (initial?.hashtags ?? seed?.hashtags ?? []).join(" "),
  );
  const [firstComment, setFirstComment] = React.useState(
    initial?.firstComment.text ?? seed?.firstComment ?? "",
  );
  const [themeId, setThemeId] = React.useState(initial?.themeId ?? seed?.themeId ?? "");
  const [destination, setDestination] = React.useState<Destination>(
    initial?.status === "queued" || initial?.status === "scheduled" ? initial.status : "draft",
  );
  const [scheduledAt, setScheduledAt] = React.useState<string>(
    initial?.scheduledAt ? new Date(initial.scheduledAt).toISOString().slice(0, 16) : "",
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Média — repris depuis initial (édition) ou vide (création). Modifié par
  // VisualEditor via onAttach dès qu'un visuel est généré.
  const [media, setMedia] = React.useState(
    initial?.media ?? { kind: "none" as const, assetId: null as string | null, altText: "", title: "" },
  );

  const currentTheme = themes.find((t) => t._id === themeId);
  const visualMode = currentTheme?.visual.mode ?? "none";

  const hashtagList = React.useMemo(
    () =>
      hashtags
        .split(/\s+/)
        .map((h) => h.trim())
        .filter(Boolean),
    [hashtags],
  );

  const hashtagInvalid = hashtagList.filter((h) => !/^#[A-Za-z0-9_]+$/.test(h));
  const contentOver = content.length > POST_CONTENT_MAX;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (hashtagInvalid.length > 0) {
      setError(`Hashtag(s) mal formé(s) : ${hashtagInvalid.join(", ")}`);
      return;
    }
    if (contentOver) {
      setError(`Contenu ${content.length} car. > limite ${POST_CONTENT_MAX}`);
      return;
    }

    const status =
      destination === "scheduled"
        ? "scheduled"
        : destination === "queued"
          ? "queued"
          : "draft";

    const payload = {
      content,
      hashtags: hashtagList,
      themeId: themeId || null,
      status,
      source: initial?.source ?? "manual",
      media,
      firstComment: {
        text: firstComment.trim() || null,
        status: firstComment.trim() ? "pending" : "none",
      },
      queuePosition: initial?.queuePosition ?? 0,
      scheduledAt: destination === "scheduled" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      sourceExternalId: initial?.sourceExternalId ?? null,
    };

    setSaving(true);
    try {
      const url = mode === "create" ? "/api/linkedin/posts" : `/api/linkedin/posts/${initial?._id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.push("/linkedin/posts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-6">
      {/* Colonne gauche : édition */}
      <div className="space-y-4">
        <Card className="p-5 space-y-4">
          <Field label="Contenu">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={16}
              placeholder="Écris ton post ici. La 1re ligne fait l'accroche (≤ 100 caractères recommandé)."
              className="font-sans"
              required
            />
          </Field>
          <Field label="Hashtags" hint="Séparés par des espaces. Format : #MotSansEspace">
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#dev #formation #dwwm" />
          </Field>
          <Field
            label="Premier commentaire"
            hint="Les liens vont ICI (le validateur du lot 5 rejettera les liens dans le contenu). Rappel : impossible à poster via l'API — spike lot 1 → à coller à la main."
          >
            <Textarea value={firstComment} onChange={(e) => setFirstComment(e.target.value)} rows={3} placeholder="→ Lien vers la ressource : https://…" />
          </Field>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Thème">
              <Select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                <option value="">Sans thème</option>
                {themes.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.emoji ? `${t.emoji} ` : ""}{t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Destination">
              <Select value={destination} onChange={(e) => setDestination(e.target.value as Destination)}>
                <option value="draft">Brouillon</option>
                <option value="queued">Mettre en file</option>
                <option value="scheduled">Programmer</option>
              </Select>
            </Field>
            {destination === "scheduled" ? (
              <Field label="Publier le" hint="Heure locale (fuseau du navigateur)" className="md:col-span-2">
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
              </Field>
            ) : null}
          </div>
        </Card>

        {visualMode !== "none" ? (
          <VisualEditor
            mode={visualMode}
            onAttach={({ assetId, kind }) => {
              setMedia((prev) => ({
                kind,
                assetId,
                altText: prev.altText,
                title: prev.title,
              }));
            }}
          />
        ) : null}

        {media.kind !== "none" && media.assetId ? (
          <Alert tone="info">
            Visuel attaché ({media.kind}) — assetId <code className="font-mono">{media.assetId}</code>.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => setMedia({ kind: "none", assetId: null, altText: "", title: "" })}
            >
              Détacher
            </button>
          </Alert>
        ) : null}

        {media.kind !== "none" ? (
          <Card className="p-5 space-y-4">
            <Field label="Alt text (obligatoire dès qu'il y a un média)">
              <Input
                value={media.altText}
                onChange={(e) => setMedia((m) => ({ ...m, altText: e.target.value }))}
                maxLength={120}
                placeholder="Description succincte du visuel pour l'accessibilité."
              />
            </Field>
            {media.kind === "document" ? (
              <Field label="Titre du document (obligatoire)">
                <Input
                  value={media.title}
                  onChange={(e) => setMedia((m) => ({ ...m, title: e.target.value }))}
                  maxLength={200}
                />
              </Field>
            ) : null}
          </Card>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={saving}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={saving || content.trim().length === 0}>
            {saving ? "Enregistrement…" : mode === "create" ? "Créer le post" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {/* Colonne droite : aperçu */}
      <div className="lg:sticky lg:top-4 space-y-3 self-start">
        <p className="text-xs font-mono uppercase tracking-wider text-fg-muted">Aperçu LinkedIn</p>
        <LinkedInPostPreview content={content} hashtags={hashtagList} firstComment={firstComment} />
      </div>
    </form>
  );
}
