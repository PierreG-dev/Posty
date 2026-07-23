"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Textarea } from "@/modules/shared/ui/primitives";
import type { MailSettings } from "@/modules/mailing/domain/mail-settings";

interface Props {
  initialSettings: MailSettings;
  twentyConfigured: boolean;
}

export function SettingsEditor({ initialSettings, twentyConfigured }: Props) {
  const [s, setS] = React.useState<MailSettings>(initialSettings);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [ping, setPing] = React.useState<null | { ok: boolean; error?: string }>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/mailing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtp: s.smtp,
          imap: s.imap,
          twenty: s.twenty,
          greeting: s.greeting,
          bccLogs: s.bccLogs,
          paused: s.paused,
          dryRun: s.dryRun,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { settings: MailSettings };
      setS(j.settings);
      setMsg("Enregistré");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function testTwenty() {
    setPing(null);
    const r = await fetch("/api/mailing/twenty/ping", { method: "POST" });
    const j = (await r.json()) as { ok: boolean; error?: string };
    setPing(j);
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <header>
        <h1 className="text-xl font-semibold">Réglages Mailing</h1>
      </header>

      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="danger">{err}</Alert> : null}

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Contrôle</h2>
        </div>
        <div className="flex items-center gap-6">
          <Checkbox
            checked={s.paused}
            onChange={(e) => setS({ ...s, paused: e.target.checked })}
            label={<span>Pause globale <span className="text-fg-muted">(arrêt d&apos;urgence)</span></span>}
          />
          <Checkbox
            checked={s.dryRun}
            onChange={(e) => setS({ ...s, dryRun: e.target.checked })}
            label={<span>dryRun <span className="text-fg-muted">(rien ne part réellement)</span></span>}
          />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Twenty CRM</h2>
          <div className="flex items-center gap-2">
            {twentyConfigured ? <Badge tone="published">env configuré</Badge> : <Badge tone="failed">env manquant</Badge>}
            <Button size="sm" onClick={testTwenty} disabled={!twentyConfigured}>
              Tester la connexion
            </Button>
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          Le token vit dans <code className="font-mono">TWENTY_API_KEY</code> (env), envoyé en header{" "}
          <code className="font-mono">Authorization: Bearer</code>. Jamais en base, jamais en URL.
        </p>
        <Field label="URL de l'API Twenty (info)" hint="Cette valeur est aussi lue depuis TWENTY_API_URL de l'env.">
          <Input
            value={s.twenty.apiUrl}
            onChange={(e) => setS({ ...s, twenty: { apiUrl: e.target.value } })}
            placeholder="https://crm.mondomaine.fr"
          />
        </Field>
        {ping ? (
          ping.ok ? <Alert tone="success">Connexion Twenty OK.</Alert>
                  : <Alert tone="danger">Twenty : {ping.error}</Alert>
        ) : null}
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-medium">SMTP</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Host">
            <Input value={s.smtp.host} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, host: e.target.value } })} />
          </Field>
          <Field label="Port">
            <Input type="number" value={s.smtp.port} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, port: Number(e.target.value) } })} />
          </Field>
          <Field label="Utilisateur">
            <Input value={s.smtp.user} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, user: e.target.value } })} />
          </Field>
          <Field label="Mot de passe">
            <Input type="password" value={s.smtp.pass} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, pass: e.target.value } })} />
          </Field>
          <Field label="From">
            <Input value={s.smtp.from} onChange={(e) => setS({ ...s, smtp: { ...s.smtp, from: e.target.value } })} />
          </Field>
          <Field label="BCC logs">
            <Input
              value={s.bccLogs ?? ""}
              onChange={(e) => setS({ ...s, bccLogs: e.target.value || null })}
              placeholder="logs@example.com"
            />
          </Field>
        </div>
        <Checkbox
          checked={s.smtp.secure}
          onChange={(e) => setS({ ...s, smtp: { ...s.smtp, secure: e.target.checked } })}
          label="TLS strict (secure)"
        />
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-medium">IMAP</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Host">
            <Input value={s.imap.host} onChange={(e) => setS({ ...s, imap: { ...s.imap, host: e.target.value } })} />
          </Field>
          <Field label="Port">
            <Input type="number" value={s.imap.port} onChange={(e) => setS({ ...s, imap: { ...s.imap, port: Number(e.target.value) } })} />
          </Field>
          <Field label="Utilisateur">
            <Input value={s.imap.user} onChange={(e) => setS({ ...s, imap: { ...s.imap, user: e.target.value } })} />
          </Field>
          <Field label="Mot de passe">
            <Input type="password" value={s.imap.pass} onChange={(e) => setS({ ...s, imap: { ...s.imap, pass: e.target.value } })} />
          </Field>
          <Field label="Dossier d'archivage">
            <Input value={s.imap.archiveFolder} onChange={(e) => setS({ ...s, imap: { ...s.imap, archiveFolder: e.target.value } })} />
          </Field>
          <Field label="Dossier INBOX">
            <Input value={s.imap.inboxFolder} onChange={(e) => setS({ ...s, imap: { ...s.imap, inboxFolder: e.target.value } })} />
          </Field>
          <Field label="Dossier spam">
            <Input value={s.imap.spamFolder} onChange={(e) => setS({ ...s, imap: { ...s.imap, spamFolder: e.target.value } })} />
          </Field>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-medium">Génération de la salutation</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Modèle">
            <Input
              value={s.greeting.model}
              onChange={(e) => setS({ ...s, greeting: { ...s.greeting, model: e.target.value } })}
            />
          </Field>
          <Field label="Temperature">
            <Input
              type="number"
              step="0.1"
              min={0}
              max={1}
              value={s.greeting.temperature}
              onChange={(e) => setS({ ...s, greeting: { ...s.greeting, temperature: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Max tokens">
            <Input
              type="number"
              value={s.greeting.maxTokens}
              onChange={(e) => setS({ ...s, greeting: { ...s.greeting, maxTokens: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <Field label="Prompt système" hint="Éditable. Utilisé pour toutes les nouvelles salutations. L'humain peut toujours éditer une salutation à la main dans /mailing/contacts.">
          <Textarea
            rows={12}
            value={s.greeting.systemPrompt}
            onChange={(e) => setS({ ...s, greeting: { ...s.greeting, systemPrompt: e.target.value } })}
            className="font-mono text-xs"
          />
        </Field>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={busy}>Enregistrer</Button>
      </div>
    </div>
  );
}
