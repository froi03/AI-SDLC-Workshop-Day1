import { test, expect } from '@playwright/test';
import { getNextRecurrenceDueDate } from '@/lib/recurrence';
import { todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

function singaporeFuture(days: number): string {
  const candidate = getSingaporeNow().plus({ days });
  const iso = candidate.toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to compute due date');
  }
  return iso;
}

test.describe('Recurring todo behaviour', () => {
  const createdTodoIds: number[] = [];

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      try {
        todoDB.delete(todoId, TEST_USER_ID);
      } catch (error) {
        // Entry may already be removed
      }
    }
  });

  test('todoDB.create stores recurrence metadata and update can disable it', () => {
    const dueDate = singaporeFuture(1);

    const recurring = todoDB.create({
      userId: TEST_USER_ID,
      title: `Recurring ${Date.now()}`,
      description: 'Validate persistence',
      priority: 'medium',
      dueDate,
      isRecurring: true,
      recurrencePattern: 'weekly',
      reminderMinutes: 60
    });
    createdTodoIds.push(recurring.id);

    expect(recurring.isRecurring).toBeTruthy();
    expect(recurring.recurrencePattern).toBe('weekly');

    const updated = todoDB.update(recurring.id, TEST_USER_ID, {
      isRecurring: false,
      recurrencePattern: null
    });

    expect(updated.isRecurring).toBeFalsy();
    expect(updated.recurrencePattern).toBeNull();
  });

  test('getNextRecurrenceDueDate advances the due date in Singapore timezone', () => {
    const dueDate = singaporeFuture(2);

    const nextDaily = getNextRecurrenceDueDate(dueDate, 'daily');
    const nextWeekly = getNextRecurrenceDueDate(dueDate, 'weekly');

    expect(nextDaily).not.toBeNull();
    expect(nextWeekly).not.toBeNull();

    if (nextDaily && nextWeekly) {
      const diffDaily = new Date(nextDaily).getTime() - new Date(dueDate).getTime();
      const diffWeekly = new Date(nextWeekly).getTime() - new Date(dueDate).getTime();
      expect(diffDaily).toBeGreaterThan(0);
      expect(diffWeekly).toBeGreaterThan(diffDaily);
    }

    const invalid = getNextRecurrenceDueDate('not-a-date', 'monthly');
    expect(invalid).toBeNull();
  });
});
