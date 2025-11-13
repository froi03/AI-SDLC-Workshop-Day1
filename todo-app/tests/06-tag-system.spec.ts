import { test, expect } from '@playwright/test';
import { tagDB, todoDB } from '@/lib/db';

const TEST_USER_ID = 1;

function createTodo(title: string) {
  return todoDB.create({
    userId: TEST_USER_ID,
    title,
    description: 'Tag system test todo',
    priority: 'medium',
    dueDate: null,
    isRecurring: false,
    recurrencePattern: null,
    reminderMinutes: null
  });
}

test.describe('Tag system database helpers', () => {
  const createdTagIds: number[] = [];
  const createdTodoIds: number[] = [];

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      todoDB.delete(todoId, TEST_USER_ID);
    }
    for (const tagId of createdTagIds.splice(0)) {
      tagDB.delete(tagId, TEST_USER_ID);
    }
  });

  test('tagDB.create trims fields and enforces unique names per user', () => {
    const first = tagDB.create(TEST_USER_ID, {
      name: ' Focus ' ,
      color: '#1D4ED8',
      description: ' Primary work items '
    });
    createdTagIds.push(first.id);

    expect(first.name).toBe('Focus');
    expect(first.description).toBe('Primary work items');

    expect(() =>
      tagDB.create(TEST_USER_ID, {
        name: 'focus',
        color: '#1D4ED8'
      })
    ).toThrow();
  });

  test('attachTag and detachTag maintain todo associations', () => {
    const todo = createTodo(`Tag attach ${Date.now()}`);
    createdTodoIds.push(todo.id);

    const tag = tagDB.create(TEST_USER_ID, {
      name: `Project-${Date.now()}`,
      color: '#0EA5E9'
    });
    createdTagIds.push(tag.id);

    const attached = tagDB.attachTag(todo.id, tag.id, TEST_USER_ID);
    expect(attached.some((entry) => entry.id === tag.id)).toBeTruthy();

    const fetched = tagDB.listByTodo(todo.id, TEST_USER_ID);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].name).toBe(tag.name);

    const refreshedTodo = todoDB.getById(todo.id, TEST_USER_ID);
    expect(refreshedTodo?.tags.map((entry) => entry.id)).toContain(tag.id);

    const afterDetach = tagDB.detachTag(todo.id, tag.id, TEST_USER_ID);
    expect(afterDetach).toHaveLength(0);

    const postDetachTodo = todoDB.getById(todo.id, TEST_USER_ID);
    expect(postDetachTodo?.tags).toHaveLength(0);
  });

  test('listWithCounts returns usage totals', () => {
    const todo = createTodo(`Tag counts ${Date.now()}`);
    createdTodoIds.push(todo.id);

    const tag = tagDB.create(TEST_USER_ID, {
      name: `Analytics-${Date.now()}`,
      color: '#14B8A6'
    });
    createdTagIds.push(tag.id);

    tagDB.attachTag(todo.id, tag.id, TEST_USER_ID);

    const tags = tagDB.listWithCounts(TEST_USER_ID);
    const target = tags.find((entry) => entry.id === tag.id);
    expect(target).toBeDefined();
    expect(target?.todoCount).toBeGreaterThanOrEqual(1);
  });
});
