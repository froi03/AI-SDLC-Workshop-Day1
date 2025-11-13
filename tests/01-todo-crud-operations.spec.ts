import { test, expect } from '@playwright/test';
import { subtaskDB, todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

function singaporeFuture(hours: number): string {
  const candidate = getSingaporeNow().plus({ hours });
  const iso = candidate.toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to derive ISO timestamp');
  }
  return iso;
}

test.describe('Todo CRUD operations', () => {
  const createdTodoIds: number[] = [];

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      try {
        todoDB.delete(todoId, TEST_USER_ID);
      } catch (error) {
        // Entry may already be removed during the test
      }
    }
  });

  test('todoDB.create persists full metadata and listByUser returns the record', () => {
    const dueDate = singaporeFuture(2);

    const created = todoDB.create({
      userId: TEST_USER_ID,
      title: `Create todo ${Date.now()}`,
      description: 'Ensure persistence works',
      priority: 'medium',
      dueDate,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: 30
    });
    createdTodoIds.push(created.id);

    expect(created.title).toContain('Create todo');
    expect(created.dueDate).toBe(dueDate);
    expect(created.reminderMinutes).toBe(30);
    expect(created.isCompleted).toBeFalsy();
    expect(created.subtasks).toEqual([]);
    expect(created.tags).toEqual([]);

    const listed = todoDB.listByUser(TEST_USER_ID);
    expect(listed.some((todo) => todo.id === created.id)).toBeTruthy();
  });

  test('todoDB.update toggles completion state and clears nullable fields', () => {
    const created = todoDB.create({
      userId: TEST_USER_ID,
      title: `Update todo ${Date.now()}`,
      description: 'Toggle completion',
      priority: 'low',
      dueDate: singaporeFuture(3),
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: 15
    });
    createdTodoIds.push(created.id);

    const completed = todoDB.toggleComplete(created.id, TEST_USER_ID, true);
    expect(completed.isCompleted).toBeTruthy();
    expect(completed.completedAt).not.toBeNull();
    expect(completed.lastNotificationSent).toBeNull();

    const cleared = todoDB.update(created.id, TEST_USER_ID, {
      title: 'Updated title',
      description: 'Updated description',
      priority: 'high',
      dueDate: null,
      reminderMinutes: null,
      isRecurring: false,
      recurrencePattern: null
    });

    expect(cleared.title).toBe('Updated title');
    expect(cleared.description).toBe('Updated description');
    expect(cleared.priority).toBe('high');
    expect(cleared.dueDate).toBeNull();
    expect(cleared.reminderMinutes).toBeNull();
    expect(cleared.recurrencePattern).toBeNull();
  });

  test('todoDB.delete removes todos and cascades subtasks', () => {
    const created = todoDB.create({
      userId: TEST_USER_ID,
      title: `Delete todo ${Date.now()}`,
      description: 'Verify cascade',
      priority: 'medium',
      dueDate: null,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(created.id);

    const first = subtaskDB.create(created.id, TEST_USER_ID, { title: 'First step' });
    expect(first.subtask.todoId).toBe(created.id);

    todoDB.delete(created.id, TEST_USER_ID);

    expect(() => subtaskDB.listByTodo(created.id, TEST_USER_ID)).toThrow('Todo not found');
    createdTodoIds.splice(0); // prevent afterEach double-delete
  });
});
