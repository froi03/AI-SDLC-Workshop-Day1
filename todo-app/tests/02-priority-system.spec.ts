import { test, expect } from '@playwright/test';
import { todoDB, type Priority } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

type CreateOverrides = Partial<{
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  isRecurring: boolean;
  reminderMinutes: number | null;
}>;

function futureDueInMinutes(minutes: number): string {
  const iso = getSingaporeNow().plus({ minutes }).toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to derive future due date');
  }
  return iso;
}

test.describe('Priority system', () => {
  const createdTodoIds: number[] = [];

  const registerTodo = (todoId: number) => {
    createdTodoIds.push(todoId);
  };

  const createTodo = (overrides: CreateOverrides = {}) => {
    const todo = todoDB.create({
      userId: TEST_USER_ID,
      title: overrides.title ?? `Priority spec ${Date.now()}`,
      description: overrides.description ?? 'Priority system coverage todo',
      priority: overrides.priority ?? 'medium',
      dueDate: overrides.dueDate ?? null,
      isRecurring: overrides.isRecurring ?? false,
      recurrencePattern: null,
      reminderMinutes: overrides.reminderMinutes ?? null
    });
    registerTodo(todo.id);
    return todo;
  };

  const safeDeleteTodo = (todoId: number) => {
    try {
      todoDB.delete(todoId, TEST_USER_ID);
    } catch {
      // Ignore deletion errors in cleanup
    }
  };

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      safeDeleteTodo(todoId);
    }
  });

  test('todoDB.create rejects invalid priority values', () => {
    expect(() =>
      todoDB.create({
        userId: TEST_USER_ID,
        title: `Invalid priority ${Date.now()}`,
        description: '',
        priority: 'urgent' as Priority,
        dueDate: null,
        isRecurring: false,
        recurrencePattern: null,
        reminderMinutes: null
      })
    ).toThrow(/CHECK constraint failed/i);
  });

  test('todoDB.update enforces priority constraint', () => {
    const todo = createTodo({ title: 'Constraint guard', priority: 'medium' });

    expect(() =>
      todoDB.update(todo.id, TEST_USER_ID, {
        priority: 'urgent' as Priority
      })
    ).toThrow(/CHECK constraint failed/i);

    const refreshed = todoDB.getById(todo.id, TEST_USER_ID);
    expect(refreshed).toBeDefined();
    expect(refreshed?.priority).toBe('medium');
  });

  test('listByUser sorts by priority rank, then due date, then creation time', () => {
    const highSoon = createTodo({ title: 'High soon', priority: 'high', dueDate: futureDueInMinutes(45) });
    const highLater = createTodo({ title: 'High later', priority: 'high', dueDate: futureDueInMinutes(180) });
    const mediumDue = createTodo({ title: 'Medium due', priority: 'medium', dueDate: futureDueInMinutes(120) });
    const mediumNoDue = createTodo({ title: 'Medium none', priority: 'medium', dueDate: null });
    const lowDue = createTodo({ title: 'Low due', priority: 'low', dueDate: futureDueInMinutes(90) });
    const lowNoDue = createTodo({ title: 'Low none', priority: 'low', dueDate: null });

    const createdIds = new Set([highSoon.id, highLater.id, mediumDue.id, mediumNoDue.id, lowDue.id, lowNoDue.id]);

    const orderedTitles = todoDB
      .listByUser(TEST_USER_ID)
      .filter((entry) => createdIds.has(entry.id))
      .map((entry) => entry.title);

    expect(orderedTitles).toEqual(['High soon', 'High later', 'Medium due', 'Medium none', 'Low due', 'Low none']);
  });

  test('updating priority reorders todos within listByUser results', () => {
    const medium = createTodo({ title: 'Medium baseline', priority: 'medium' });
    const lowLeading = createTodo({ title: 'Low leading', priority: 'low' });
    const lowTrailing = createTodo({ title: 'Low trailing', priority: 'low' });

    const createdIds = new Set([medium.id, lowLeading.id, lowTrailing.id]);

    const initialOrder = todoDB
      .listByUser(TEST_USER_ID)
      .filter((entry) => createdIds.has(entry.id))
      .map((entry) => entry.title);
    expect(initialOrder).toEqual(['Medium baseline', 'Low leading', 'Low trailing']);

    const updated = todoDB.update(lowLeading.id, TEST_USER_ID, { priority: 'high' });
    expect(updated.priority).toBe('high');

    const reordered = todoDB
      .listByUser(TEST_USER_ID)
      .filter((entry) => createdIds.has(entry.id))
      .map((entry) => entry.title);
    expect(reordered).toEqual(['Low leading', 'Medium baseline', 'Low trailing']);
  });
});

