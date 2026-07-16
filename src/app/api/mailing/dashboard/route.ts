import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { PARIS } from "@/modules/shared/luxon";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { countPendingBreakdown } from "@/modules/mailing/repositories/mail-queue-repo";
import { countBreakdownOnParisDay } from "@/modules/mailing/repositories/mail-log-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getMailSettings();
  const now = new Date();
  const [sentToday, pending] = await Promise.all([
    countBreakdownOnParisDay(now),
    countPendingBreakdown(),
  ]);
  return NextResponse.json({
    settings: {
      dailyCap: settings.dailyCap,
      paused: settings.paused,
      dryRun: settings.dryRun,
      sendDays: settings.sendDays,
      jitter: settings.jitter,
    },
    sentToday,
    pending,
    nextSlot: nextSlotIso(settings.sendDays, now),
  });
}

function nextSlotIso(
  sendDays: { dayOfWeek: number; time: string }[],
  now: Date,
): string | null {
  const nowP = DateTime.fromJSDate(now).setZone(PARIS);
  let best: DateTime | null = null;
  for (let offset = 0; offset < 8; offset++) {
    const day = nowP.plus({ days: offset });
    for (const s of sendDays) {
      if (s.dayOfWeek !== day.weekday) continue;
      const [hStr, mStr] = s.time.split(":");
      const candidate = day.set({
        hour: Number(hStr),
        minute: Number(mStr),
        second: 0,
        millisecond: 0,
      });
      if (candidate <= nowP) continue;
      if (!best || candidate < best) best = candidate;
    }
    if (best) break;
  }
  return best ? (best.toUTC().toISO() ?? null) : null;
}
