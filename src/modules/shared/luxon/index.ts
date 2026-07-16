import { DateTime } from "luxon";

export const PARIS = "Europe/Paris" as const;

export function nowParis(): DateTime {
  return DateTime.now().setZone(PARIS);
}

export function nowUtc(): DateTime {
  return DateTime.utc();
}

export function toParis(d: Date | DateTime): DateTime {
  const dt = d instanceof DateTime ? d : DateTime.fromJSDate(d);
  return dt.setZone(PARIS);
}

export function toUtc(d: Date | DateTime): DateTime {
  const dt = d instanceof DateTime ? d : DateTime.fromJSDate(d);
  return dt.toUTC();
}

export function formatParis(d: Date | DateTime, fmt = "yyyy-LL-dd HH:mm"): string {
  return toParis(d).toFormat(fmt);
}

export { DateTime };
