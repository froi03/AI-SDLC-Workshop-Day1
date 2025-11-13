import { DateTime } from 'luxon';
import type { Priority, Todo } from '@/lib/db';

const SINGAPORE_ZONE = 'Asia/Singapore';
const PRIORITY_WEIGHT: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function normalizeMonth(month: DateTime): DateTime {
  return month.setZone(SINGAPORE_ZONE, { keepLocalTime: false }).startOf('month');
}

function normalizeDate(value: DateTime): DateTime {
  return value.setZone(SINGAPORE_ZONE, { keepLocalTime: false }).startOf('day');
}

export function buildCalendarMatrix(month: DateTime): DateTime[][] {
  const normalized = normalizeMonth(month);
  let cursor = normalized.startOf('week');
  const days: DateTime[] = [];

  for (let i = 0; i < 42; i += 1) {
    days.push(cursor);
    cursor = cursor.plus({ days: 1 });
  }

  const weeks: DateTime[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return weeks;
}

export function bucketTodosByDate(todos: Todo[]): Map<string, Todo[]> {
  const buckets = new Map<string, Todo[]>();

  for (const todo of todos) {
    if (!todo.dueDate) {
      continue;
    }

    const date = DateTime.fromISO(todo.dueDate).setZone(SINGAPORE_ZONE, { keepLocalTime: false });
    if (!date.isValid) {
      continue;
    }

    const key = date.startOf('day').toISODate();
    if (!key) {
      continue;
    }

    const existing = buckets.get(key);
    if (existing) {
      existing.push(todo);
    } else {
      buckets.set(key, [todo]);
    }
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => {
      if (a.priority !== b.priority) {
        return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      }

      const aDue = a.dueDate ? DateTime.fromISO(a.dueDate).toMillis() : 0;
      const bDue = b.dueDate ? DateTime.fromISO(b.dueDate).toMillis() : 0;
      return aDue - bDue;
    });
  }

  return buckets;
}

export function toSingaporeDateKey(value: DateTime): string {
  const key = normalizeDate(value).toISODate();
  if (!key) {
    throw new Error('Failed to derive Singapore date key');
  }
  return key;
}

export { SINGAPORE_ZONE };
