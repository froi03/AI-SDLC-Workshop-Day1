import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { EXPORT_VERSION, subtaskDB, tagDB, todoDB, type TodosExportPayload } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

function requireIso(dateTime: DateTime): string {
  const iso = dateTime.toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to produce ISO string');
  }
  return iso;
}

test.describe('Export and import helpers', () => {
  const createdTodoIds: number[] = [];
  const createdTagIds: number[] = [];

  test.afterEach(() => {
    for (const todoId of createdTodoIds.splice(0)) {
      try {
        todoDB.delete(todoId, TEST_USER_ID);
      } catch {
        // Ignore if already removed
      }
    }
    for (const tagId of createdTagIds.splice(0)) {
      try {
        tagDB.delete(tagId, TEST_USER_ID);
      } catch {
        // Ignore if already removed
      }
    }
  });

  test('exportData captures todos, tags, subtasks, and relationships', () => {
    const tag = tagDB.create(TEST_USER_ID, {
      name: `Export-${Date.now()}`,
      color: '#3B82F6'
    });
    createdTagIds.push(tag.id);

    const dueIso = requireIso(getSingaporeNow().plus({ hours: 6 }));

    const todo = todoDB.create({
      userId: TEST_USER_ID,
      title: `Export sample ${Date.now()}`,
      description: 'Export coverage todo',
      priority: 'high',
      dueDate: dueIso,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: 60
    });
    createdTodoIds.push(todo.id);

    tagDB.attachTag(todo.id, tag.id, TEST_USER_ID);
    subtaskDB.create(todo.id, TEST_USER_ID, { title: 'Prepare export payload' });

    const payload = todoDB.exportData(TEST_USER_ID);

    expect(payload.version).toBe(EXPORT_VERSION);
    expect(payload.todos.some((entry) => entry.id === todo.id)).toBeTruthy();
    expect(payload.tags.some((entry) => entry.id === tag.id)).toBeTruthy();
    expect(payload.subtasks.some((entry) => entry.todoId === todo.id)).toBeTruthy();
    expect(payload.todoTags.some((entry) => entry.todoId === todo.id && entry.tagId === tag.id)).toBeTruthy();
  });

  test('importData remaps ids and reuses existing tags by name', () => {
    const existingTag = tagDB.create(TEST_USER_ID, {
      name: 'Focus',
      color: '#22C55E',
      description: 'Carry over'
    });
    createdTagIds.push(existingTag.id);

    const generatedAt = requireIso(getSingaporeNow());

    const payload: TodosExportPayload = {
      version: EXPORT_VERSION,
      generatedAt,
      todos: [
        {
          id: 101,
          title: 'Imported focus task',
          description: 'Restored from backup',
          priority: 'medium',
          dueDate: null,
          isCompleted: false,
          completedAt: null,
          isRecurring: false,
          recurrencePattern: null,
          reminderMinutes: null,
          lastNotificationSent: null,
          createdAt: generatedAt,
          updatedAt: generatedAt
        }
      ],
      subtasks: [
        {
          id: 301,
          todoId: 101,
          title: 'Review import steps',
          position: 1,
          isCompleted: false,
          createdAt: generatedAt,
          updatedAt: generatedAt
        }
      ],
      tags: [
        {
          id: 201,
          name: 'Focus',
          color: '#22C55E',
          description: null,
          createdAt: generatedAt,
          updatedAt: generatedAt
        },
        {
          id: 202,
          name: 'Backlog',
          color: '#3B82F6',
          description: 'New tag from import',
          createdAt: generatedAt,
          updatedAt: generatedAt
        }
      ],
      todoTags: [
        { todoId: 101, tagId: 201 },
        { todoId: 101, tagId: 202 }
      ]
    };

    const result = todoDB.importData(TEST_USER_ID, payload);

    createdTodoIds.push(...result.createdTodoIds);
    createdTagIds.push(...result.createdTagIds);

    expect(result.createdTodoIds).toHaveLength(1);
    expect(result.createdSubtaskIds).toHaveLength(1);
    expect(result.createdTagIds).toHaveLength(1);

    const importedTodo = todoDB.getById(result.createdTodoIds[0], TEST_USER_ID);
    expect(importedTodo).toBeDefined();
    expect(importedTodo?.title).toBe('Imported focus task');
    const importedTagIds = importedTodo?.tags.map((tag) => tag.id) ?? [];
    expect(importedTagIds).toContain(existingTag.id);
    if (result.createdTagIds[0]) {
      expect(importedTagIds).toContain(result.createdTagIds[0]);
    }
    expect(importedTodo?.subtasks.map((entry) => entry.title)).toEqual(['Review import steps']);
  });

  test('importData rejects unsupported export versions', () => {
    const payload: TodosExportPayload = {
      version: '0.9',
      generatedAt: new Date().toISOString(),
      todos: [],
      subtasks: [],
      tags: [],
      todoTags: []
    };

    expect(() => todoDB.importData(TEST_USER_ID, payload)).toThrow('Unsupported export version');
  });
});
