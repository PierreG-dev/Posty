"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Textarea } from "@/modules/shared/ui/primitives";
import { EXCLUSION_LABELS } from "@/modules/mailing/services/campaigns-audience";
import type { ExclusionReason } from "@/modules/mailing/domain/campaigns";

// Composer d'une campagne : sujet, corps, blocs, cibles, aperçu, mise en file.
//
// Simplifications de conception :
//   - Un seul écran, sections dépliables. Les données passent d'une section à
//     la suivante sans routage : évite le pattern « brouillon multi-étapes »
//     qui casse à la moindre erreur.
//   - Édition libre tant que status === 'draft'. Une fois queued, l'écran de
//     tracking prend le relais (voir /mailing/campaigns/[id]).

interface Block {
  _id: string;
  name: string;
  kind: string;
  content: string;
}

interface CandidateContact {
  id: string;
  name: string;
  status: string | null;
  followupCount: number;
  contactEmail: { primaryEmail: string | null } | null;
  meta: { greeting: string | null; paused: boolean; bounce: { kind: string } | null } | null;
  isAutoHandled: boolean;
}

interface Decision {
  companyId: string;
  name: string;
  email: string | null;
  status: string | null;
  followupCount: number;
  eligible: boolean;
  reason: ExclusionReason | null;
  greetingPreview: string | null;
}

interface Preview {
  companyId: string;
  companyName: string;
  email: string | null;
  greeting: string;
  subject: string;
  body: string;
}

export interface CampaignDraft {
  _id: string;
  name: string;
  subject: string;
  body: string;
  blockIds: string[];
  targetCompanyIds: string[];
}

export interface CampaignSettingsHint {
  dailyCap: number;
  sendDaysPerWeek: number;
}

export function CampaignComposer({
  campaign,
  blocks,
  settingsHint,
}: {
  campaign: CampaignDraft;
  blocks: Block[];
  settingsHint: CampaignSettingsHint;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(campaign.name);
  const [subject, setSubject] = React.useState(campaign.subject);
  const [body, setBody] = React.useState(campaign.body);
  const [selectedBlockIds, setSelectedBlockIds] = React.useState<string[]>(campaign.blockIds);
  const [selectedTargets, setSelectedTargets] = React.useState<string[]>(campaign.targetCompanyIds);
  const [savingMsg, setSavingMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Cible loader
  const [statusFilter, setStatusFilter] = React.useState<"PROSPECT" | "CLIENT">("PROSPECT");
  const [candidates, setCandidates] = React.useState<CandidateContact[]>([]);
  const [loadingCandidates, setLoadingCandidates] = React.useState(false);
  const [decisions, setDecisions] = React.useState<Map<string, Decision>>(new Map());

  const [previews, setPreviews] = React.useState<Preview[] | null>(null);
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [enqueueing, setEnqueueing] = React.useState(false);

  const dirty =
    name !== campaign.name ||
    subject !== campaign.subject ||
    body !== campaign.body ||
    !sameSet(selectedBlockIds, campaign.blockIds) ||
    !sameSet(selectedTargets, campaign.targetCompanyIds);

  async function save() {
    setSavingMsg("Enregistrement…");
    setError(null);
    const r = await fetch(`/api/mailing/campaigns/${campaign._id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        subject,
        body,
        blockIds: selectedBlockIds,
        targetCompanyIds: selectedTargets,
      }),
    });
    if (!r.ok) {
      setError(`Enregistrement échoué (${r.status}).`);
      setSavingMsg(null);
      return;
    }
    setSavingMsg("Enregistré.");
    setTimeout(() => setSavingMsg(null), 1500);
    router.refresh();
  }

  async function loadCandidates() {
    setLoadingCandidates(true);
    try {
      const r = await fetch(`/api/mailing/contacts?status=${statusFilter}&limit=200`);
      const data = await r.json();
      const items = (data.contacts ?? []) as CandidateContact[];
      // Coté client : pré-filtre pour ne pas montrer les PROSPECTS < 3 relances
      // (l'API audience les rejettera aussi, mais ça allège la liste montrée).
      const filtered =
        statusFilter === "PROSPECT" ? items.filter((c) => c.followupCount >= 3) : items;
      setCandidates(filtered);
      await refreshDecisions(filtered.map((c) => c.id));
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function refreshDecisions(ids: string[]) {
    if (ids.length === 0) {
      setDecisions(new Map());
      return;
    }
    const r = await fetch(`/api/mailing/campaigns/${campaign._id}/audience`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateIds: ids }),
    });
    const data = await r.json();
    const m = new Map<string, Decision>();
    for (const d of (data.decisions ?? []) as Decision[]) m.set(d.companyId, d);
    setDecisions(m);
  }

  function toggleTarget(id: string) {
    setSelectedTargets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function requestPreview() {
    if (dirty) {
      setError("Enregistre d'abord avant l'aperçu.");
      return;
    }
    setLoadingPreview(true);
    setPreviews(null);
    setError(null);
    try {
      const r = await fetch(`/api/mailing/campaigns/${campaign._id}/preview`, {
        method: "POST",
      });
      const data = await r.json();
      setPreviews((data.previews ?? []) as Preview[]);
      if ((data.previews ?? []).length === 0) {
        setError("Aucun destinataire éligible — vérifie ta sélection.");
      }
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doEnqueue() {
    if (dirty) {
      setError("Enregistre d'abord avant la mise en file.");
      return;
    }
    if (
      !confirm(
        `Confirmer la mise en file ? ${selectedTargets.length} contact(s) sélectionné(s) — l'éligibilité sera revérifiée côté serveur.`,
      )
    )
      return;
    setEnqueueing(true);
    setError(null);
    try {
      const r = await fetch(`/api/mailing/campaigns/${campaign._id}/enqueue`, {
        method: "POST",
      });
      const data = await r.json();
      if (!r.ok) {
        setError(`Mise en file refusée : ${data.error ?? r.status}`);
        return;
      }
      router.push(`/mailing/campaigns/${campaign._id}`);
      router.refresh();
    } finally {
      setEnqueueing(false);
    }
  }

  const eligibleCount = React.useMemo(() => {
    let n = 0;
    for (const id of selectedTargets) {
      const d = decisions.get(id);
      if (d?.eligible) n++;
    }
    return n;
  }, [selectedTargets, decisions]);

  const excludedInSelection = selectedTargets.length - eligibleCount;
  const endEstimate = estimateEnd(eligibleCount, settingsHint);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* 1. Composition */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">1. Composition</h2>
        <Field label="Nom interne">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Sujet (nouveau fil — pas de Re:)">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Corps — identique pour tous" hint={`${body.length} caractères · texte brut`}>
          <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label="Blocs à joindre — dans l'ordre">
          <div className="flex flex-wrap gap-3">
            {blocks.length === 0 ? (
              <span className="text-xs text-fg-muted">Aucun bloc défini.</span>
            ) : null}
            {blocks.map((b) => (
              <Checkbox
                key={b._id}
                checked={selectedBlockIds.includes(b._id)}
                onChange={(e) =>
                  setSelectedBlockIds((prev) =>
                    e.target.checked ? [...prev, b._id] : prev.filter((x) => x !== b._id),
                  )
                }
                label={
                  <span>
                    {b.name}{" "}
                    <span className="text-xs font-mono text-fg-muted">({b.kind})</span>
                  </span>
                }
              />
            ))}
          </div>
        </Field>
      </Card>

      {/* 2. Cibles */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">2. Cibles</h2>
          <div className="flex items-center gap-2">
            <select
              className="bg-surface-2 border border-border rounded-md px-2 py-1 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "PROSPECT" | "CLIENT")}
            >
              <option value="PROSPECT">PROSPECT (followup ≥ 3)</option>
              <option value="CLIENT">CLIENT</option>
            </select>
            <Button size="sm" onClick={loadCandidates} disabled={loadingCandidates}>
              {loadingCandidates ? "Chargement…" : "Charger"}
            </Button>
          </div>
        </div>

        {candidates.length > 0 ? (
          <div className="max-h-96 overflow-auto border border-border rounded-md divide-y divide-border">
            {candidates.map((c) => {
              const d = decisions.get(c.id);
              const excluded = d ? !d.eligible : false;
              const checked = selectedTargets.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={cnRow(excluded, checked)}
                >
                  <input
                    type="checkbox"
                    disabled={excluded}
                    checked={checked && !excluded}
                    onChange={() => !excluded && toggleTarget(c.id)}
                    className="w-4 h-4 accent-accent disabled:opacity-30"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-xs text-fg-muted font-mono truncate">
                      {c.contactEmail?.primaryEmail ?? "— sans email —"} · {c.status ?? "?"} · followup {c.followupCount}
                    </div>
                  </div>
                  {excluded && d?.reason ? (
                    <Badge tone="failed">{EXCLUSION_LABELS[d.reason]}</Badge>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-fg-muted">
            Charge une liste pour cocher les cibles. Les exclusions
            (PARTENAIRE, pause, bounce, kill-switch, déjà destinataire) sont
            appliquées automatiquement et non contournables.
          </p>
        )}

        <div className="text-sm text-fg-muted">
          <span className="font-mono">{selectedTargets.length}</span> sélectionné(s) ·{" "}
          <span className="font-mono text-published">{eligibleCount}</span> éligible(s)
          {excludedInSelection > 0 ? (
            <>
              {" "}·{" "}
              <span className="font-mono text-failed">{excludedInSelection}</span> à écarter
            </>
          ) : null}
        </div>
      </Card>

      {/* 3. Enregistrer / Prévisualiser / Mettre en file */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">3. Aperçu et mise en file</h2>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={!dirty}>
            {dirty ? "Enregistrer" : "Enregistré"}
          </Button>
          <Button onClick={requestPreview} disabled={loadingPreview}>
            {loadingPreview ? "Rendu…" : "Aperçu sur 3 destinataires"}
          </Button>
          <Button
            variant="primary"
            onClick={doEnqueue}
            disabled={enqueueing || eligibleCount === 0}
          >
            {enqueueing ? "Enfilement…" : `Mettre en file (${eligibleCount})`}
          </Button>
          {savingMsg ? <span className="text-xs text-fg-muted">{savingMsg}</span> : null}
        </div>

        <div className="text-xs text-fg-muted font-mono">
          {eligibleCount > 0 ? (
            <>
              {eligibleCount} contacts · ~{settingsHint.dailyCap} par créneau max ·
              fin estimée {endEstimate ?? "—"}
            </>
          ) : (
            "Sélectionne des cibles éligibles pour estimer la durée."
          )}
        </div>

        {previews && previews.length > 0 ? (
          <div className="space-y-3">
            {previews.map((p, i) => (
              <div key={i} className="border border-border rounded-md p-3 bg-surface-2/40">
                <div className="text-xs font-mono text-fg-muted mb-2">
                  → {p.companyName} · {p.email}
                </div>
                <div className="text-sm font-semibold mb-2">Sujet : {p.subject}</div>
                <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
                  {p.body}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function cnRow(excluded: boolean, checked: boolean): string {
  const base = "flex items-center gap-3 px-3 py-2 text-sm";
  if (excluded) return `${base} opacity-50 bg-failed/5`;
  if (checked) return `${base} bg-accent/5`;
  return base;
}

/**
 * Estimation grossière : `dailyCap` par jour d'envoi, campagnes derrière. On
 * ne modélise pas la contention avec la séquence auto — l'estimation est un
 * plancher, pas une garantie. Voir point ouvert 4 du plan.
 */
function estimateEnd(count: number, hint: CampaignSettingsHint): string | null {
  if (count <= 0) return null;
  const perWeek = Math.max(1, hint.dailyCap * Math.max(1, hint.sendDaysPerWeek));
  const weeks = Math.ceil(count / perWeek);
  const end = new Date();
  end.setDate(end.getDate() + weeks * 7);
  return end.toLocaleDateString("fr-FR");
}
