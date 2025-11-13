import { DateTime } from 'luxon';
import type { RecurrencePattern } from './db';

const RECURRENCE_OFFSETS: Record<RecurrencePattern, { days?: number; weeks?: number; months?: number; years?: number }> = {
  daily: { days: 1 },
  weekly: { weeks: 1 },
  monthly: { months: 1 },
  yearly: { years: 1 }
};

export function getNextRecurrenceDueDate(currentDueDate: string, pattern: RecurrencePattern): string | null {
  if (!currentDueDate) {
    return null;
  }

  const current = DateTime.fromISO(currentDueDate).setZone('Asia/Singapore');
  if (!current.isValid) {
    return null;
  }

  const offsets = RECURRENCE_OFFSETS[pattern];
  const next = current.plus(offsets);
  if (!next.isValid) {
    return null;
  }

  const iso = next.toUTC().toISO();
  return iso ?? null;
}
