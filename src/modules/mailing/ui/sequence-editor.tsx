"use client";

import * as React from "react";
import { Button, Card, Field, Input, Label, Textarea, Alert, Badge } from "@/modules/shared/ui/primitives";
import type { MailSettings } from "@/modules/mailing/domain/mail-settings";
import type { MailTemplate, SequenceStep } from "@/modules/mailing/domain/mail-templates";
import type { MailBlock } from "@/modules/mailing/domain/mail-blocks";
import { renderTemplate, renderSubject, TemplateRenderError } from "@/modules/mailing/domain/render-template";

const DAYS_FR = ["", "lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

interface Props {
  initialSettings: MailSettings;
  initialTemplates: MailTemplate[];
  initialBlocks: MailBlock[];
}

interface TplState {
  step: SequenceStep;
  subject: string;
  body: string;
  blockIds: string[];
}

function ensureThreeTemplates(list: MailTemplate[]): TplState[] {
  const byStep = new Map(list.map((t) => [t.step, t]));
  return ([0, 1, 2] as const).map((step) => {
    const t = byStep.get(step);
    return t
      ? { step, subject: t.subject, body: t.body, blockIds: [...t.blockIds] }
      : { step, subject: "", body: "", blockIds: [] };
  });
}

export function SequenceEditor({ initialSettings, initialTemplates, initialBlocks }: Props) {
  const [settings, setSettings] = React.useState<MailSettings>(initialSettings);
  const [templates, setTemplates] = React.useState<TplState[]>(ensureThreeTemplates(initialTemplates));
  const [blocks, setBlocks] = React.useState<MailBlock[]>(initialBlocks);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  async function saveSettings() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/mailing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sendDays: settings.sendDays,
          dailyCap: settings.dailyCap,
          jitter: settings.jitter,
          sequence: settings.sequence,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { settings: MailSettings };
      setSettings(j.settings);
      setMsg("Réglages enregistrés");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(t: TplState) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/mailing/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(`Template step ${t.step} enregistré`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 space-y-8 max-w-5xl">
      <header>
        <h1 className="text-xl font-semibold">Séquence automatique</h1>
        <p className="text-sm text-fg-muted mt-1">
          Les 3 mails de séquence, les délais entre relances, les jours d&apos;envoi, le plafond et le jitter.
        </p>
      </header>

      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="danger">{err}</Alert> : null}

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Cadence d&apos;envoi</h2>
          <Button size="sm" variant="primary" onClick={saveSettings} disabled={busy}>
            Enregistrer
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Plafond par jour" hint="Tous types confondus (relances + premiers + campagnes).">
            <Input
              type="number"
              min={1}
              max={500}
              value={settings.dailyCap}
              onChange={(e) => setSettings({ ...settings, dailyCap: Number(e.target.value) })}
            />
          </Field>
          <Field label="Jitter min (s)">
            <Input
              type="number"
              min={0}
              value={settings.jitter.minSeconds}
              onChange={(e) => setSettings({
                ...settings,
                jitter: { ...settings.jitter, minSeconds: Number(e.target.value) },
              })}
            />
          </Field>
          <Field label="Jitter max (s)">
            <Input
              type="number"
              min={0}
              value={settings.jitter.maxSeconds}
              onChange={(e) => setSettings({
                ...settings,
                jitter: { ...settings.jitter, maxSeconds: Number(e.target.value) },
              })}
            />
          </Field>
        </div>

        <Field label="Délais séquence (jours) — step 0→1, 1→2, 2→fin">
          <div className="flex gap-2">
            {settings.sequence.delays.map((d, i) => (
              <Input
                key={i}
                type="number"
                min={0}
                value={d}
                onChange={(e) => {
                  const copy = [...settings.sequence.delays];
                  copy[i] = Number(e.target.value);
                  setSettings({ ...settings, sequence: { ...settings.sequence, delays: copy } });
                }}
              />
            ))}
          </div>
        </Field>

        <Field label="Créneaux d'envoi (jour de la semaine + heure HH:MM)">
          <div className="space-y-2">
            {settings.sendDays.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
                  value={d.dayOfWeek}
                  onChange={(e) => {
                    const copy = [...settings.sendDays];
                    copy[i] = { ...d, dayOfWeek: Number(e.target.value) };
                    setSettings({ ...settings, sendDays: copy });
                  }}
                >
                  {DAYS_FR.slice(1).map((label, idx) => (
                    <option key={idx + 1} value={idx + 1}>{label}</option>
                  ))}
                </select>
                <Input
                  type="time"
                  value={d.time}
                  onChange={(e) => {
                    const copy = [...settings.sendDays];
                    copy[i] = { ...d, time: e.target.value };
                    setSettings({ ...settings, sendDays: copy });
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSettings({ ...settings, sendDays: settings.sendDays.filter((_, j) => j !== i) })}
                >
                  Retirer
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              onClick={() => setSettings({ ...settings, sendDays: [...settings.sendDays, { dayOfWeek: 2, time: "10:30" }] })}
            >
              + Ajouter un créneau
            </Button>
          </div>
        </Field>
      </Card>

      {templates.map((t) => (
        <TemplateEditor
          key={t.step}
          tpl={t}
          blocks={blocks}
          onChange={(next) => setTemplates((prev) => prev.map((x) => (x.step === t.step ? next : x)))}
          onSave={() => saveTemplate(t)}
          busy={busy}
        />
      ))}

      <BlocksSection blocks={blocks} onChanged={setBlocks} />
    </div>
  );
}

function TemplateEditor({
  tpl,
  blocks,
  onChange,
  onSave,
  busy,
}: {
  tpl: TplState;
  blocks: MailBlock[];
  onChange: (next: TplState) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const preview = React.useMemo(() => {
    try {
      const usedBlocks = blocks.filter((b) => tpl.blockIds.includes(b._id));
      const subject = renderSubject(tpl.subject, { greeting: "Bonjour l'équipe d'ExempleCorp," });
      const body = renderTemplate(tpl.body, { greeting: "Bonjour l'équipe d'ExempleCorp," }, usedBlocks);
      return { subject, body, error: null as string | null };
    } catch (e) {
      return {
        subject: "",
        body: "",
        error: e instanceof TemplateRenderError ? e.message : String(e),
      };
    }
  }, [tpl, blocks]);

  const label = tpl.step === 0 ? "Premier contact" : tpl.step === 1 ? "Relance 1" : "Relance 2";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone="accent">step {tpl.step}</Badge>
          <h2 className="font-medium">{label}</h2>
        </div>
        <Button size="sm" variant="primary" onClick={onSave} disabled={busy}>
          Enregistrer ce template
        </Button>
      </div>

      <Field label="Sujet">
        <Input value={tpl.subject} onChange={(e) => onChange({ ...tpl, subject: e.target.value })} />
      </Field>

      <Field label="Corps" hint="Utilise {{GREETING}} pour la salutation et {{BLOCK:nom}} pour insérer un bloc.">
        <Textarea
          rows={10}
          value={tpl.body}
          onChange={(e) => onChange({ ...tpl, body: e.target.value })}
          className="font-mono text-xs"
        />
      </Field>

      <Field label="Blocs à appender (signature, footer…)">
        <div className="flex flex-wrap gap-2">
          {blocks.length === 0 ? (
            <p className="text-xs text-fg-muted">Aucun bloc — crée-en un plus bas.</p>
          ) : null}
          {blocks.map((b) => {
            const active = tpl.blockIds.includes(b._id);
            return (
              <button
                key={b._id}
                type="button"
                onClick={() => {
                  const next = active ? tpl.blockIds.filter((id) => id !== b._id) : [...tpl.blockIds, b._id];
                  onChange({ ...tpl, blockIds: next });
                }}
                className={
                  "text-xs px-2 py-1 rounded border " +
                  (active ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-2 text-fg-muted border-border")
                }
              >
                {b.name}
              </button>
            );
          })}
        </div>
      </Field>

      <div>
        <Label>Aperçu (avec une salutation d&apos;exemple)</Label>
        {preview.error ? (
          <Alert tone="danger">{preview.error}</Alert>
        ) : (
          <div className="rounded-md border border-border bg-bg p-4 space-y-2">
            <div className="text-xs font-mono text-fg-muted">Sujet : {preview.subject}</div>
            <pre className="text-xs whitespace-pre-wrap font-sans">{preview.body}</pre>
          </div>
        )}
      </div>
    </Card>
  );
}

function BlocksSection({ blocks, onChanged }: { blocks: MailBlock[]; onChanged: (b: MailBlock[]) => void }) {
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/mailing/blocks");
    if (r.ok) {
      const j = (await r.json()) as { blocks: MailBlock[] };
      onChanged(j.blocks);
    }
  }

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/mailing/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: "custom", content }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setName("");
      setContent("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Supprimer ce bloc ?")) return;
    await fetch(`/api/mailing/blocks/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-medium">Blocs réutilisables</h2>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      <div className="space-y-2">
        {blocks.map((b) => (
          <div key={b._id} className="flex items-start gap-3 border border-border rounded-md p-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono">
                {b.name} <Badge tone="neutral">{b.kind}</Badge>
              </div>
              <pre className="text-xs text-fg-muted whitespace-pre-wrap mt-1">{b.content}</pre>
            </div>
            <Button size="sm" variant="ghost" onClick={() => remove(b._id)}>
              Suppr.
            </Button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border">
        <Field label="Nom du bloc" className="md:col-span-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="signature" />
        </Field>
        <Field label="Contenu" className="md:col-span-2">
          <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
      </div>
      <div>
        <Button variant="primary" onClick={create} disabled={busy || !name.trim() || !content.trim()}>
          + Créer un bloc
        </Button>
      </div>
    </Card>
  );
}
