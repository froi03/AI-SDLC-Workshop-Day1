import { DateTime } from 'luxon';

const SINGAPORE_ZONE = 'Asia/Singapore';

export function getSingaporeNow(): DateTime {
  return DateTime.now().setZone(SINGAPORE_ZONE, { keepLocalTime: false });
}

export function formatSingaporeDate(value: string | DateTime | null, format = "dd MMM yyyy, hh:mma"): string {
  if (!value) {
    return 'No due date';
  }

  const dateTime = typeof value === 'string' ? DateTime.fromISO(value).setZone(SINGAPORE_ZONE) : value.setZone(SINGAPORE_ZONE);

  if (!dateTime.isValid) {
    return 'Invalid date';
  }

  return dateTime.toFormat(format);
}

export function parseSingaporeDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const dateTime = DateTime.fromISO(value, { zone: SINGAPORE_ZONE });

  if (!dateTime.isValid) {
    throw new Error('Invalid date format');
  }

  const iso = dateTime.toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to convert date to ISO string');
  }

  return iso;
}

export function isFutureSingaporeDate(value: string): boolean {
  const now = getSingaporeNow();
  const target = DateTime.fromISO(value).setZone(SINGAPORE_ZONE);
  if (!target.isValid) {
    return false;
  }

  return target.diff(now, 'minutes').minutes >= 1;
}
