import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import type { NextRequest } from 'next/server';
import { POST as createTodoHandler } from '@/app/api/todos/route';
import { PUT as updateTodoHandler } from '@/app/api/todos/[id]/route';
import { tagDB, todoDB, type Priority, type RecurrencePattern, type Todo } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';
import { getNextRecurrenceDueDate } from '@/lib/recurrence';

const TEST_USER_ID = 1;

const RECURRENCE_PATTERNS: RecurrencePattern[] = ['daily', 'weekly', 'monthly', 'yearly'];

function futureDueInHours(hours: number): string {
  const iso = getSingaporeNow().plus({ hours }).toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to generate due date');
  }
  return iso;
}

function buildJsonRequest(url: string, method: 'POST' | 'PUT', body: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }) as unknown as NextRequest;
}

function buildParams(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

test.describe('Recurring todos', () => {
  const createdTodoIds: number[] = [];
  const createdTagIds: number[] = [];

  const registerTodo = (id: number) => {
    createdTodoIds.push(id);
  };

  const registerTag = (id: number) => {
    createdTagIds.push(id);
  };

  const safeDeleteTodo = (id: number) => {
    try {
      todoDB.delete(id, TEST_USER_ID);
    } catch {
      // ignore cleanup failures
    }
  };

  const safeDeleteTag = (id: number) => {
    try {
      tagDB.delete(id, TEST_USER_ID);
    } catch {
      // ignore cleanup failures
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

  test('getNextRecurrenceDueDate calculates future due dates in Singapore timezone', () => {
    const baseSingapore = DateTime.fromObject(
      { year: 2025, month: 1, day: 31, hour: 9, minute: 30 },
      { zone: 'Asia/Singapore' }
    );
    const baseIso = baseSingapore.toUTC().toISO();
    if (!baseIso) {
      throw new Error('Failed to derive base ISO');
    }

    for (const pattern of RECURRENCE_PATTERNS) {
      const expected = baseSingapore.plus({
        days: pattern === 'daily' ? 1 : 0,
        weeks: pattern === 'weekly' ? 1 : 0,
        months: pattern === 'monthly' ? 1 : 0,
        years: pattern === 'yearly' ? 1 : 0
      });
      const expectedIso = expected.toUTC().toISO();
      const nextIso = getNextRecurrenceDueDate(baseIso, pattern);
      expect(nextIso).toBe(expectedIso);
    }
  });

  test('POST /api/todos rejects recurring todo without due date', async () => {
    const request = buildJsonRequest('http://localhost/api/todos', 'POST', {
      title: 'Recurring without due date',
      description: 'Validation test',
      priority: 'medium' as Priority,
      isRecurring: true,
      recurrencePattern: 'weekly' as RecurrencePattern
    });

    const response = await createTodoHandler(request);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain('Recurring todos require a due date');
  });

  test('completing a recurring todo creates the next occurrence with inherited metadata', async () => {
    const dueDate = futureDueInHours(24);
    const original = todoDB.create({
      userId: TEST_USER_ID,
      title: `Recurring origin ${Date.now()}`,
      description: 'Source recurring todo',
      priority: 'high',
      dueDate,
      isRecurring: true,
      recurrencePattern: 'weekly',
      reminderMinutes: 60
    });
    registerTodo(original.id);

    const tag = tagDB.create(TEST_USER_ID, {
      name: `Weekly-${Date.now()}`,
      color: '#2563EB',
      description: 'Recurring tag'
    });
    registerTag(tag.id);
    tagDB.attachTag(original.id, tag.id, TEST_USER_ID);

    const response = await updateTodoHandler(
      buildJsonRequest(`http://localhost/api/todos/${original.id}`, 'PUT', { isCompleted: true }),
      buildParams(original.id)
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { todo: Todo; nextTodo: Todo | null };

    expect(payload.todo.isCompleted).toBeTruthy();
    expect(payload.todo.completedAt).not.toBeNull();
    expect(payload.nextTodo).not.toBeNull();
    if (!payload.nextTodo) {
      throw new Error('Expected nextTodo to be present');
    }

    registerTodo(payload.nextTodo.id);

    const expectedDue = getNextRecurrenceDueDate(dueDate, 'weekly');
    expect(payload.nextTodo.dueDate).toBe(expectedDue);
    expect(payload.nextTodo.priority).toBe('high');
    expect(payload.nextTodo.isRecurring).toBeTruthy();
    expect(payload.nextTodo.recurrencePattern).toBe('weekly');
    expect(payload.nextTodo.reminderMinutes).toBe(60);

    const copiedTagIds = payload.nextTodo.tags.map((entry) => entry.id);
    expect(copiedTagIds).toEqual([tag.id]);

    const storedNext = todoDB.getById(payload.nextTodo.id, TEST_USER_ID);
    expect(storedNext).toBeDefined();
    expect(storedNext?.isCompleted).toBeFalsy();
    expect(storedNext?.tags.map((entry) => entry.id)).toEqual([tag.id]);
  });

  test('disabling recurrence before completion prevents new instance creation', async () => {
    const dueDate = futureDueInHours(12);
    const original = todoDB.create({
      userId: TEST_USER_ID,
      title: `Toggle recurrence ${Date.now()}`,
      description: 'Disable recurrence test',
      priority: 'medium',
      dueDate,
      isRecurring: true,
      recurrencePattern: 'monthly',
      reminderMinutes: null
    });
    registerTodo(original.id);

    const existingIds = new Set(todoDB.listByUser(TEST_USER_ID).map((entry) => entry.id));

    const response = await updateTodoHandler(
      buildJsonRequest(`http://localhost/api/todos/${original.id}`, 'PUT', {
        isRecurring: false,
        recurrencePattern: null,
        isCompleted: true
      }),
      buildParams(original.id)
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { todo: Todo; nextTodo: Todo | null };

    expect(payload.todo.isCompleted).toBeTruthy();
    expect(payload.todo.isRecurring).toBeFalsy();
    expect(payload.todo.recurrencePattern).toBeNull();
    expect(payload.nextTodo).toBeNull();

    const refreshed = todoDB.getById(original.id, TEST_USER_ID);
    expect(refreshed?.isRecurring).toBeFalsy();
    expect(refreshed?.recurrencePattern).toBeNull();
    expect(refreshed?.isCompleted).toBeTruthy();

    const afterIds = new Set(todoDB.listByUser(TEST_USER_ID).map((entry) => entry.id));
    const extraIds = [...afterIds].filter((id) => !existingIds.has(id));
    for (const id of extraIds) {
      registerTodo(id);
    }
    expect(extraIds).toHaveLength(0);
  });
});
