import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { todoDB } from '@/lib/db';
import { bucketTodosByDate } from '@/lib/calendar';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

function futureIso(minutesFromNow: number): string {
  const candidate = getSingaporeNow().plus({ minutes: minutesFromNow });
  const iso = candidate.toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to convert candidate to ISO');
  }
  return iso;
}

function toUtcIso(dateTime: DateTime): string {
  const iso = dateTime.toUTC().toISO();
  if (!iso) {
    throw new Error('Unable to convert DateTime to ISO');
  }
  return iso;
}

test.describe('Priority system behaviour', () => {
  const createdTodoIds: number[] = [];

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      try {
        todoDB.delete(todoId, TEST_USER_ID);
      } catch (error) {
        // Already removed
      }
    }
  });

  test('todoDB.listByUser sorts by priority weight before due date', () => {
    const sharedDue = futureIso(120);

    const medium = todoDB.create({
      userId: TEST_USER_ID,
      title: `Medium ${Date.now()}`,
      description: 'Medium priority task',
      priority: 'medium',
      dueDate: sharedDue,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(medium.id);

    const high = todoDB.create({
      userId: TEST_USER_ID,
      title: `High ${Date.now()}`,
      description: 'High priority task',
      priority: 'high',
      dueDate: sharedDue,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(high.id);

    const low = todoDB.create({
      userId: TEST_USER_ID,
      title: `Low ${Date.now()}`,
      description: 'Low priority task',
      priority: 'low',
      dueDate: sharedDue,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(low.id);

    const ordered = todoDB.listByUser(TEST_USER_ID);
    const idsInOrder = ordered.map((todo) => todo.id);
    expect(idsInOrder.indexOf(high.id)).toBeLessThan(idsInOrder.indexOf(medium.id));
    expect(idsInOrder.indexOf(medium.id)).toBeLessThan(idsInOrder.indexOf(low.id));
  });

  test('bucketTodosByDate sorts higher priority then earlier due time within the same day', () => {
    const base = DateTime.fromISO(futureIso(90)).setZone('Asia/Singapore');

    const high = todoDB.create({
      userId: TEST_USER_ID,
      title: `Bucket high ${Date.now()}`,
      description: 'High bucket',
      priority: 'high',
      dueDate: toUtcIso(base.plus({ minutes: 5 })),
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(high.id);

    const medium = todoDB.create({
      userId: TEST_USER_ID,
      title: `Bucket medium ${Date.now()}`,
      description: 'Medium bucket',
      priority: 'medium',
      dueDate: toUtcIso(base.plus({ minutes: 15 })),
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(medium.id);

    const anotherHigh = todoDB.create({
      userId: TEST_USER_ID,
      title: `Bucket high later ${Date.now()}`,
      description: 'Later high priority',
      priority: 'high',
      dueDate: toUtcIso(base.plus({ minutes: 45 })),
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(anotherHigh.id);

    const bucket = bucketTodosByDate(todoDB.listByUser(TEST_USER_ID));
    const key = base.startOf('day').toISODate();
    expect(key).toBeTruthy();
    const todos = bucket.get(key!);
    expect(todos).toBeDefined();
    expect(todos).toHaveLength(3);
    expect(todos![0].id).toBe(high.id);
    expect(todos![1].id).toBe(anotherHigh.id);
    expect(todos![2].id).toBe(medium.id);
  });
});
