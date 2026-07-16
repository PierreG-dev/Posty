"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea, Field, Select, Alert, Card, Badge } from "@/modules/shared/ui/primitives";
import { LinkedInPostPreview } from "./linkedin-post-preview";
import type { Theme } from "@/modules/linkedin/domain/theme";
import type { PostDraft } from "@/modules/linkedin/domain/post";

interface Props {
  themes: Theme[];
}

type Mode = "text" | "json";

export function PostImportPanel({ themes }: Props) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("text");
  const [raw, setRaw] = React.useState("");
  const [themeId, setThemeId] = React.useState("");
  const [defaultHashtags, setDefaultHashtags] = React.useState("");
  const [drafts, setDrafts] = React.useState<PostDraft[]>([]);
  const [errors, setErrors] = React.useState<Array<{ index: number; message: string }>>([]);
  const [previewing, setPreviewing] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const hashtagList = defaultHashtags
    .split(/\s+/)
    .map((h) => h.trim())
    .filter(Boolean);

  async function onPreview() {
    setMsg(null);
    setPreviewing(true);
    try {
      const res = await fetch("/api/linkedin/posts/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          raw,
          themeId: themeId || null,
          defaultHashtags: hashtagList,
          previewOnly: true,
        }),
      });
      const body = (await res.json()) as { drafts: PostDraft[]; errors: Array<{ index: number; message: string }> };
      setDrafts(body.drafts ?? []);
      setErrors(body.errors ?? []);
    } finally {
      setPreviewing(false);
    }
  }

  async function onImport() {
    if (drafts.length === 0) return;
    setMsg(null);
    setImporting(true);
    try {
      const res = await fetch("/api/linkedin/posts/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          raw,
          themeId: themeId || null,
          defaultHashtags: hashtagList,
          previewOnly: false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { created: number };
      router.push("/linkedin/posts");
      router.refresh();
      setMsg(`✓ ${body.created} post(s) mis en file.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-6">
      <div className="space-y-4">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">Source</h2>
            <div className="flex items-center gap-1 text-xs">
              <ModeBtn active={mode === "text"} onClick={() => setMode("text")}>Texte</ModeBtn>
              <ModeBtn active={mode === "json"} onClick={() => setMode("json")}>JSON</ModeBtn>
            </div>
          </div>

          {mode === "text" ? (
            <Field label="Colle tes posts, séparés par une ligne `---`" hint="Format identique à l'import n8n actuel">
              <Textarea rows={16} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"Premier post…\n\n---\n\nDeuxième post…\n\n---\n\nTroisième post…"} className="font-mono text-xs" />
            </Field>
          ) : (
            <Field label="Colle un objet ou un tableau JSON (§8.7)" hint="Champs : content, hashtags, firstComment, altText — le validateur strict vient au lot 5">
              <Textarea rows={16} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'[\n  {\n    "content": "…",\n    "hashtags": ["#dev"],\n    "firstComment": null\n  }\n]'} className="font-mono text-xs" />
            </Field>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Thème du lot">
              <Select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                <option value="">Sans thème</option>
                {themes.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.emoji ? `${t.emoji} ` : ""}{t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hashtags par défaut" hint="Appliqués aux posts qui n'en ont pas">
              <Textarea rows={2} value={defaultHashtags} onChange={(e) => setDefaultHashtags(e.target.value)} placeholder="#dev #dwwm" />
            </Field>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onPreview} disabled={previewing || raw.trim().length === 0}>
            {previewing ? "…" : "Prévisualiser"}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onImport}
            disabled={importing || drafts.length === 0 || errors.length > 0}
          >
            {importing ? "Import…" : `Mettre en file (${drafts.length})`}
          </Button>
        </div>

        {msg ? <Alert tone={msg.startsWith("✓") ? "success" : "danger"}>{msg}</Alert> : null}

        {errors.length > 0 ? (
          <Alert tone="danger">
            <p className="font-medium mb-1">{errors.length} erreur(s) — corrige avant d'importer :</p>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              {errors.map((e, i) => (
                <li key={i}>
                  {e.index >= 0 ? `Bloc ${e.index + 1} : ` : ""}
                  {e.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>

      <div className="space-y-3 self-start lg:sticky lg:top-4">
        <div className="flex items-center gap-2">
          <p className="text-xs font-mono uppercase tracking-wider text-fg-muted">Aperçu du lot</p>
          <Badge tone="neutral">{drafts.length}</Badge>
        </div>
        {drafts.length === 0 ? (
          <p className="text-xs text-fg-muted italic">Colle du contenu puis « Prévisualiser ».</p>
        ) : (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {drafts.slice(0, 5).map((d, i) => (
              <div key={i} className="space-y-1">
                <p className="text-[11px] text-fg-muted font-mono">Post {i + 1}</p>
                <LinkedInPostPreview
                  content={d.content}
                  hashtags={d.hashtags.length ? d.hashtags : hashtagList}
                  firstComment={d.firstComment}
                  showCounter={false}
                />
              </div>
            ))}
            {drafts.length > 5 ? (
              <p className="text-xs text-fg-muted italic text-center">
                (+ {drafts.length - 5} autre(s) post(s) non affiché(s))
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-2.5 py-1 rounded bg-accent text-accent-fg font-mono uppercase tracking-wider text-xs"
          : "px-2.5 py-1 rounded text-fg-muted hover:text-fg font-mono uppercase tracking-wider text-xs"
      }
    >
      {children}
    </button>
  );
}

