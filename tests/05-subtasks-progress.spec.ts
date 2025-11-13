import { test, expect } from '@playwright/test';
import { subtaskDB, todoDB } from '@/lib/db';

const TEST_USER_ID = 1;

function createTodo(title: string) {
  return todoDB.create({
    userId: TEST_USER_ID,
    title,
    description: 'Subtask progress test todo',
    priority: 'medium',
    dueDate: null,
    isRecurring: false,
    recurrencePattern: null,
    reminderMinutes: null
  });
}

test.describe('Subtask database helpers', () => {
  const createdTodoIds: number[] = [];

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      todoDB.delete(todoId, TEST_USER_ID);
    }
  });

  test('create assigns sequential positions and tracks progress', () => {
    const todo = createTodo(`Subtask create ${Date.now()}`);
    createdTodoIds.push(todo.id);

    const first = subtaskDB.create(todo.id, TEST_USER_ID, { title: ' First subtask ' });
    expect(first.subtask.title).toBe('First subtask');
    expect(first.subtask.position).toBe(1);
    expect(first.progress.total).toBe(1);
    expect(first.progress.percent).toBe(0);

    const second = subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Second subtask', position: 1 });
    expect(second.subtask.position).toBe(1);

    const { subtasks, progress } = subtaskDB.listByTodo(todo.id, TEST_USER_ID);
    expect(subtasks).toHaveLength(2);
    expect(subtasks[0].title).toBe('Second subtask');
    expect(subtasks[0].position).toBe(1);
    expect(subtasks[1].position).toBe(2);
    expect(progress.total).toBe(2);
  });

  test('toggleCompletion updates progress percentages', () => {
    const todo = createTodo(`Subtask toggle ${Date.now()}`);
    createdTodoIds.push(todo.id);

    const first = subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Prepare slides' });
    const second = subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Send recap' });

    expect(first.progress.total).toBe(1);
    expect(second.progress.total).toBe(2);

    const toggled = subtaskDB.toggleCompletion(first.subtask.id, TEST_USER_ID, true);
    expect(toggled.subtask.isCompleted).toBeTruthy();
    expect(toggled.progress.completed).toBe(1);
    expect(toggled.progress.total).toBe(2);

    const progress = subtaskDB.getProgress(todo.id, TEST_USER_ID);
    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.percent).toBe(50);
  });

  test('updateTitle trims values and persists changes', () => {
    const todo = createTodo(`Subtask rename ${Date.now()}`);
    createdTodoIds.push(todo.id);

    const created = subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Draft report' });
    const updated = subtaskDB.updateTitle(created.subtask.id, TEST_USER_ID, ' Final report ');
    expect(updated.subtask.title).toBe('Final report');

    const { subtasks } = subtaskDB.listByTodo(todo.id, TEST_USER_ID);
    expect(subtasks[0].title).toBe('Final report');
  });

  test('delete removes subtask and normalizes positions', () => {
    const todo = createTodo(`Subtask delete ${Date.now()}`);
    createdTodoIds.push(todo.id);

    const first = subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Step one' });
    const second = subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Step two' });
    subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Step three' });

    const progressBefore = subtaskDB.getProgress(todo.id, TEST_USER_ID);
    expect(progressBefore.total).toBe(3);

    const afterDelete = subtaskDB.delete(second.subtask.id, TEST_USER_ID);
    expect(afterDelete.total).toBe(2);
    expect(afterDelete.percent).toBe(0);

    const { subtasks } = subtaskDB.listByTodo(todo.id, TEST_USER_ID);
    expect(subtasks).toHaveLength(2);
    expect(subtasks[0].position).toBe(1);
    expect(subtasks[1].position).toBe(2);
    expect(subtasks[0].id).toBe(first.subtask.id);
  });

  test('create rejects blank titles', () => {
    const todo = createTodo(`Subtask validation ${Date.now()}`);
    createdTodoIds.push(todo.id);

    expect(() => subtaskDB.create(todo.id, TEST_USER_ID, { title: '   ' })).toThrow('Subtask title is required');
  });
});
