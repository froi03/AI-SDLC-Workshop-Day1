import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { todoDB } from '@/lib/db';
import { buildCalendarMatrix, bucketTodosByDate, toSingaporeDateKey } from '@/lib/calendar';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

function utcIso(dateTime: DateTime): string {
  const iso = dateTime.toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to produce ISO string');
  }
  return iso;
}

test.describe('Calendar view helpers', () => {
  const createdTodoIds: number[] = [];

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      try {
        todoDB.delete(todoId, TEST_USER_ID);
      } catch (error) {
        // The todo might already be removed
      }
    }
  });

  test('buildCalendarMatrix covers complete weeks for the month', () => {
    const month = DateTime.fromISO('2025-11-01T00:00:00', { zone: 'Asia/Singapore' });
    const matrix = buildCalendarMatrix(month);

    expect(matrix).toHaveLength(6);
    for (const week of matrix) {
      expect(week).toHaveLength(7);
    }

    const firstDay = matrix[0][0];
    const lastDay = matrix[matrix.length - 1][6];

    expect(firstDay.weekday).toBe(1); // Monday
    expect(firstDay.startOf('day').month).toBeLessThanOrEqual(11);
    expect(lastDay.startOf('day').month).toBeGreaterThanOrEqual(11);
  });

  test('bucketTodosByDate sorts by priority and due time per day', () => {
    const base = getSingaporeNow().plus({ days: 1 }).startOf('day').set({ hour: 9 });

    const highEarly = todoDB.create({
      userId: TEST_USER_ID,
      title: `Calendar high early ${Date.now()}`,
      description: 'Earliest high priority',
      priority: 'high',
      dueDate: utcIso(base.plus({ minutes: 10 })),
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(highEarly.id);

    const highLate = todoDB.create({
      userId: TEST_USER_ID,
      title: `Calendar high late ${Date.now()}`,
      description: 'Later high priority',
      priority: 'high',
      dueDate: utcIso(base.plus({ minutes: 40 })),
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(highLate.id);

    const medium = todoDB.create({
      userId: TEST_USER_ID,
      title: `Calendar medium ${Date.now()}`,
      description: 'Medium priority item',
      priority: 'medium',
      dueDate: utcIso(base.plus({ minutes: 5 })),
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(medium.id);

    const bucket = bucketTodosByDate(todoDB.listByUser(TEST_USER_ID));
    const key = toSingaporeDateKey(base);
    const todos = bucket.get(key);
    expect(todos).toBeDefined();
    expect(todos).toHaveLength(3);
    expect(todos![0].id).toBe(highEarly.id);
    expect(todos![1].id).toBe(highLate.id);
    expect(todos![2].id).toBe(medium.id);
  });
});
