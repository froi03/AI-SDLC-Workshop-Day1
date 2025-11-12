import { DateTime } from 'luxon';

const SINGAPORE_ZONE = 'Asia/Singapore';

export function getSingaporeNow(): Date {
  return DateTime.now().setZone(SINGAPORE_ZONE).toJSDate();
}

export function formatSingaporeDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return DateTime.fromJSDate(date)
    .setZone(SINGAPORE_ZONE)
    .toFormat("dd LLL yyyy 'at' HH:mm");
}

export function parseSingaporeInput(input: string): DateTime {
  const parsed = DateTime.fromISO(input, { zone: SINGAPORE_ZONE });
  if (!parsed.isValid) {
    throw new Error('Invalid datetime format');
  }
  return parsed;
}

export function isFutureSingaporeDateTime(input: string): boolean {
  const parsed = parseSingaporeInput(input);
  const now = DateTime.now().setZone(SINGAPORE_ZONE);
  return parsed >= now.plus({ minutes: 1 });
}

export function serializeSingaporeDate(date: Date | DateTime): string {
  const value = date instanceof Date ? DateTime.fromJSDate(date) : date;
  return value.setZone(SINGAPORE_ZONE).toUTC().toISO();
}
