"use client";

import { useMemo, useState } from "react";
import { Button, Badge, Select, Input, Field, Label, Card } from "@/modules/shared/ui/primitives";
import { Trash2, Plus } from "lucide-react";
import type { Slot, SlotModeOverride } from "@/modules/linkedin/domain/slot";

interface ThemeLite {
  _id: string;
  name: string;
  color: string;
  emoji: string;
}

interface Props {
  initialSlots: Slot[];
  themes: ThemeLite[];
  autoGeneration: boolean;
}

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;
const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i); // 07:00 → 21:00

export function SlotsCalendar({ initialSlots, themes, autoGeneration }: Props) {
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [creating, setCreating] = useState(false);
  const themeById = useMemo(() => new Map(themes.map((t) => [t._id, t])), [themes]);

  const slotsByCell = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const hour = Number(s.time.slice(0, 2));
      const key = `${s.dayOfWeek}:${hour}`;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    }
    return m;
  }, [slots]);

  async function deleteSlot(id: string) {
    if (!confirm("Supprimer ce créneau ?")) return;
    const r = await fetch(`/api/linkedin/slots/${id}`, { method: "DELETE" });
    if (r.ok) setSlots((prev) => prev.filter((s) => s._id !== id));
  }

  async function toggleActive(s: Slot) {
    const r = await fetch(`/api/linkedin/slots/${s._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    if (r.ok) {
      const { slot } = (await r.json()) as { slot: Slot };
      setSlots((prev) => prev.map((x) => (x._id === slot._id ? slot : x)));
    }
  }

  async function setMode(s: Slot, mode: SlotModeOverride | null) {
    const r = await fetch(`/api/linkedin/slots/${s._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modeOverride: mode }),
    });
    if (r.ok) {
      const { slot } = (await r.json()) as { slot: Slot };
      setSlots((prev) => prev.map((x) => (x._id === slot._id ? slot : x)));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-fg-muted">
          Mode global : <span className="font-mono text-fg">{autoGeneration ? "IA" : "File"}</span>
          <span className="mx-2">·</span>
          {slots.length} créneau(x) · {slots.filter((s) => s.active).length} actif(s)
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} strokeWidth={1.5} />
          Nouveau créneau
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="grid grid-cols-[70px_repeat(7,1fr)] text-xs font-mono border-b border-border bg-surface-2">
          <div className="p-2 text-fg-muted">Heure</div>
          {DAYS.map((d) => (
            <div key={d} className="p-2 text-center text-fg-muted">{d}</div>
          ))}
        </div>
        {HOURS.map((h) => (
          <div key={h} className="grid grid-cols-[70px_repeat(7,1fr)] border-b border-border/60 min-h-[52px]">
            <div className="p-2 text-xs font-mono text-fg-muted">{String(h).padStart(2, "0")}:00</div>
            {DAYS.map((_, dowIdx) => {
              const dow = dowIdx + 1;
              const cellSlots = slotsByCell.get(`${dow}:${h}`) ?? [];
              return (
                <div key={dow} className="p-1 border-l border-border/40 space-y-1">
                  {cellSlots.map((s) => {
                    const t = themeById.get(s.themeId);
                    const effective: SlotModeOverride =
                      s.modeOverride ?? (autoGeneration ? "auto" : "queue");
                    return (
                      <div
                        key={s._id}
                        className={`rounded px-1.5 py-1 text-[11px] leading-tight border ${s.active ? "" : "opacity-40"}`}
                        style={{
                          backgroundColor: (t?.color ?? "#FFB020") + "22",
                          borderColor: (t?.color ?? "#FFB020") + "55",
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-fg">{s.time}</span>
                          <Badge tone={effective === "auto" ? "scheduled" : "queued"}>
                            {effective === "auto" ? "IA" : "File"}
                          </Badge>
                        </div>
                        <div className="truncate text-fg" title={t?.name}>
                          {t?.emoji ?? "◆"} {t?.name ?? "?"}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Select
                            className="text-[10px] py-0 h-5"
                            value={s.modeOverride ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMode(s, v === "" ? null : (v as SlotModeOverride));
                            }}
                          >
                            <option value="">Suit global</option>
                            <option value="queue">File</option>
                            <option value="auto">IA</option>
                          </Select>
                          <button
                            type="button"
                            onClick={() => toggleActive(s)}
                            className="text-[10px] px-1 rounded border border-border hover:bg-surface-2"
                            title={s.active ? "Désactiver" : "Activer"}
                          >
                            {s.active ? "✓" : "○"}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSlot(s._id)}
                            className="text-fg-muted hover:text-status-failed"
                            title="Supprimer"
                          >
                            <Trash2 size={12} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </Card>

      {creating ? (
        <NewSlotForm
          themes={themes}
          onCancel={() => setCreating(false)}
          onCreated={(s) => {
            setSlots((prev) => [...prev, s]);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

function NewSlotForm({
  themes,
  onCancel,
  onCreated,
}: {
  themes: ThemeLite[];
  onCancel: () => void;
  onCreated: (s: Slot) => void;
}) {
  const [dayOfWeek, setDay] = useState(2);
  const [time, setTime] = useState("09:00");
  const [themeId, setThemeId] = useState(themes[0]?._id ?? "");
  const [modeOverride, setMode] = useState<"" | SlotModeOverride>("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/linkedin/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          dayOfWeek,
          time,
          themeId,
          modeOverride: modeOverride === "" ? null : modeOverride,
          active: true,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Erreur");
      }
      const { slot } = (await r.json()) as { slot: Slot };
      onCreated(slot);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <Field>
          <Label>Jour</Label>
          <Select value={dayOfWeek} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i + 1}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>Heure (Paris)</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
        <Field>
          <Label>Thème</Label>
          <Select value={themeId} onChange={(e) => setThemeId(e.target.value)} required>
            {themes.map((t) => (
              <option key={t._id} value={t._id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>Mode</Label>
          <Select value={modeOverride} onChange={(e) => setMode(e.target.value as "" | SlotModeOverride)}>
            <option value="">Suit global</option>
            <option value="queue">File</option>
            <option value="auto">IA</option>
          </Select>
        </Field>
        <Field>
          <Label>Libellé (optionnel)</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </Field>
        <div className="md:col-span-5 flex items-center justify-end gap-2">
          {err ? <span className="text-sm text-status-failed mr-auto">{err}</span> : null}
          <Button variant="ghost" type="button" onClick={onCancel}>Annuler</Button>
          <Button variant="primary" type="submit" disabled={busy || !themeId}>
            {busy ? "Création…" : "Créer"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
