import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { subtaskDB, tagDB, todoDB, type Priority, type RecurrencePattern } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

type CreateOverrides = Partial<{
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern | null;
  reminderMinutes: number | null;
}>;

function futureDueInMinutes(minutes: number): string {
  const iso = getSingaporeNow().plus({ minutes }).toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to derive future due date');
  }
  return iso;
}

test.describe('Todo CRUD operations', () => {
  const createdTodoIds: number[] = [];
  const createdTagIds: number[] = [];

  const registerTodo = (todoId: number) => {
    createdTodoIds.push(todoId);
  };

  const registerTag = (tagId: number) => {
    createdTagIds.push(tagId);
  };

  const createTodo = (overrides: CreateOverrides = {}) => {
    const todo = todoDB.create({
      userId: TEST_USER_ID,
      title: overrides.title ?? `Todo ${Date.now()}`,
      description: overrides.description ?? 'Playwright CRUD test todo',
      priority: overrides.priority ?? 'medium',
      dueDate: overrides.dueDate ?? null,
      isRecurring: overrides.isRecurring ?? false,
      recurrencePattern: overrides.recurrencePattern ?? null,
      reminderMinutes: overrides.reminderMinutes ?? null
    });
    registerTodo(todo.id);
    return todo;
  };

  const safeDeleteTodo = (todoId: number) => {
    try {
      todoDB.delete(todoId, TEST_USER_ID);
    } catch {
      // already removed
    }
  };

  const safeDeleteTag = (tagId: number) => {
    try {
      tagDB.delete(tagId, TEST_USER_ID);
    } catch {
      // already removed
    }
  };

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      safeDeleteTodo(todoId);
    }
    for (const tagId of createdTagIds.splice(0)) {
      safeDeleteTag(tagId);
    }
  });

  test('create minimal todo sets expected defaults', () => {
    const todo = createTodo({ description: '' });

    expect(todo.title).toMatch(/^Todo \d+/);
    expect(todo.description).toBe('');
    expect(todo.priority).toBe('medium');
    expect(todo.dueDate).toBeNull();
    expect(todo.isCompleted).toBeFalsy();
    expect(todo.isRecurring).toBeFalsy();
    expect(todo.recurrencePattern).toBeNull();
    expect(todo.reminderMinutes).toBeNull();
    expect(todo.tags).toHaveLength(0);
    expect(todo.subtasks).toHaveLength(0);
    expect(todo.progress.total).toBe(0);
    expect(DateTime.fromISO(todo.createdAt).isValid).toBeTruthy();
    expect(DateTime.fromISO(todo.updatedAt).isValid).toBeTruthy();
  });

  test('listByUser orders active todos by priority then due date', () => {
    const highDue = futureDueInMinutes(60);
    const mediumDue = futureDueInMinutes(120);
    const lowDue = futureDueInMinutes(30);

    const low = createTodo({ title: 'Low priority', priority: 'low', dueDate: lowDue });
    const high = createTodo({ title: 'High priority', priority: 'high', dueDate: highDue });
    const medium = createTodo({ title: 'Medium priority', priority: 'medium', dueDate: mediumDue });

    const createdIds = new Set([low.id, high.id, medium.id]);
    const ordered = todoDB
      .listByUser(TEST_USER_ID)
      .filter((entry) => createdIds.has(entry.id))
      .map((entry) => entry.title);

    expect(ordered).toEqual(['High priority', 'Medium priority', 'Low priority']);
  });

  test('listByUser returns tags, subtasks, and progress stats', () => {
    const todo = createTodo({ title: 'Todo with relations' });
    const tag = tagDB.create(TEST_USER_ID, {
      name: `Focus-${Date.now()}`,
      color: '#3B82F6',
      description: 'Focus tag'
    });
    registerTag(tag.id);

    tagDB.attachMany(todo.id, [tag.id], TEST_USER_ID);
    const firstSubtask = subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Draft outline' });
    subtaskDB.toggleCompletion(firstSubtask.subtask.id, TEST_USER_ID, true);
    subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Collect assets' });

    const fetched = todoDB.listByUser(TEST_USER_ID).find((entry) => entry.id === todo.id);
    expect(fetched).toBeDefined();
    expect(fetched?.tags.map((entry) => entry.id)).toEqual([tag.id]);
    expect(fetched?.subtasks).toHaveLength(2);
    expect(fetched?.progress.total).toBe(2);
    expect(fetched?.progress.completed).toBe(1);
    expect(fetched?.progress.percent).toBe(50);
  });

  test('update applies partial changes and handles nullifying fields', () => {
    const todo = createTodo({ title: 'Update me' });

    const dueDate = futureDueInMinutes(180);
    const updated = todoDB.update(todo.id, TEST_USER_ID, {
      title: 'Updated title',
      description: 'Updated description',
      priority: 'high',
      dueDate,
      isRecurring: true,
      recurrencePattern: 'weekly',
      reminderMinutes: 120
    });

    expect(updated.title).toBe('Updated title');
    expect(updated.description).toBe('Updated description');
    expect(updated.priority).toBe('high');
    expect(updated.dueDate).toBe(dueDate);
    expect(updated.isRecurring).toBeTruthy();
    expect(updated.recurrencePattern).toBe('weekly');
    expect(updated.reminderMinutes).toBe(120);

    const cleared = todoDB.update(todo.id, TEST_USER_ID, {
      dueDate: null,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });

    expect(cleared.dueDate).toBeNull();
    expect(cleared.isRecurring).toBeFalsy();
    expect(cleared.recurrencePattern).toBeNull();
    expect(cleared.reminderMinutes).toBeNull();
  });

  test('toggleComplete flips completion state and timestamps', () => {
    const todo = createTodo({ title: 'Toggle completion' });

    const completed = todoDB.toggleComplete(todo.id, TEST_USER_ID, true);
    expect(completed.isCompleted).toBeTruthy();
    expect(completed.completedAt).not.toBeNull();
    if (completed.completedAt) {
      expect(DateTime.fromISO(completed.completedAt).isValid).toBeTruthy();
    }

    const reopened = todoDB.toggleComplete(todo.id, TEST_USER_ID, false);
    expect(reopened.isCompleted).toBeFalsy();
    expect(reopened.completedAt).toBeNull();
  });

  test('delete removes todo and cascades to subtasks and tag assignments', () => {
    const todo = createTodo({ title: 'Delete source' });
    const tag = tagDB.create(TEST_USER_ID, {
      name: `Cleanup-${Date.now()}`,
      color: '#F97316',
      description: 'Cleanup tag'
    });
    registerTag(tag.id);

    tagDB.attachTag(todo.id, tag.id, TEST_USER_ID);
    subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Prep deck' });

    todoDB.delete(todo.id, TEST_USER_ID);

    const index = createdTodoIds.indexOf(todo.id);
    if (index >= 0) {
      createdTodoIds.splice(index, 1);
    }

    expect(todoDB.getById(todo.id, TEST_USER_ID)).toBeUndefined();
    expect(() => subtaskDB.listByTodo(todo.id, TEST_USER_ID)).toThrow('Todo not found');
    expect(() => tagDB.listByTodo(todo.id, TEST_USER_ID)).toThrow('Todo not found');
  });
});
