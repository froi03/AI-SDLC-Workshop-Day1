import { test, expect } from '@playwright/test';
import { filterTodos } from '@/lib/filterTodos';
import type { Todo, Tag } from '@/lib/db';

const TEST_USER_ID = 1;
const BASE_TIMESTAMP = '2024-01-01T00:00:00.000Z';
let todoIdCounter = 1;

function buildTag(id: number, name: string, color = '#3B82F6'): Tag {
  return {
    id,
    userId: TEST_USER_ID,
    name,
    color,
    description: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP
  };
}

function buildTodo(overrides: Partial<Todo> = {}): Todo {
  const todo: Todo = {
    id: todoIdCounter++,
    userId: TEST_USER_ID,
    title: 'Sample todo',
    description: '',
    priority: 'medium',
    dueDate: null,
    isCompleted: false,
    completedAt: null,
    isRecurring: false,
    recurrencePattern: null,
    reminderMinutes: null,
    lastNotificationSent: null,
    tags: [],
    subtasks: [],
    progress: { completed: 0, total: 0, percent: 0 },
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides
  };

  return todo;
}

test.describe('filterTodos helper', () => {
  const designTag = buildTag(1, 'Design');
  const urgentTag = buildTag(2, 'Urgent', '#EF4444');
  const opsTag = buildTag(3, 'Operations', '#14B8A6');
  const financeTag = buildTag(4, 'Finance', '#F59E0B');

  test.beforeEach(() => {
    todoIdCounter = 1;
  });

  test('returns all todos when no filters are active', () => {
    const todos = [
      buildTodo({ title: 'Publish release notes', tags: [designTag] }),
      buildTodo({ title: 'Plan user interviews', tags: [designTag, urgentTag] })
    ];

    const filtered = filterTodos(todos, { query: '', priority: null, tagIds: [] });
    expect(filtered).toHaveLength(todos.length);
  });

  test('matches search query across titles, descriptions, and tag names', () => {
    const todos = [
      buildTodo({ title: 'Prepare weekly report', tags: [opsTag] }),
      buildTodo({ title: 'Collect feedback', description: 'Create survey for product report', tags: [designTag] }),
      buildTodo({ title: 'Reconcile invoices', tags: [financeTag] })
    ];

    const byTitle = filterTodos(todos, { query: 'weekly', priority: null, tagIds: [] });
    expect(byTitle.map((todo) => todo.id)).toEqual([todos[0].id]);

    const byDescription = filterTodos(todos, { query: 'survey', priority: null, tagIds: [] });
    expect(byDescription.map((todo) => todo.id)).toEqual([todos[1].id]);

    const byTagName = filterTodos(todos, { query: 'finance', priority: null, tagIds: [] });
    expect(byTagName.map((todo) => todo.id)).toEqual([todos[2].id]);
  });

  test('applies priority filter when provided', () => {
    const todos = [
      buildTodo({ title: 'Draft marketing brief', priority: 'high', tags: [designTag, urgentTag] }),
      buildTodo({ title: 'Tidy backlog', priority: 'medium', tags: [opsTag] })
    ];

    const filtered = filterTodos(todos, { query: '', priority: 'high', tagIds: [] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Draft marketing brief');
  });

  test('requires todos to include every selected tag (AND logic)', () => {
    const todos = [
      buildTodo({ title: 'Create launch assets', tags: [designTag, urgentTag] }),
      buildTodo({ title: 'Schedule social posts', tags: [designTag] }),
      buildTodo({ title: 'Run on-call rotation', tags: [urgentTag, opsTag] })
    ];

    const filtered = filterTodos(todos, { query: '', priority: null, tagIds: [designTag.id, urgentTag.id] });
    expect(filtered.map((todo) => todo.title)).toEqual(['Create launch assets']);
  });

  test('combines query, priority, and tags to produce a targeted subset', () => {
    const todos = [
      buildTodo({ title: 'Launch checklist meeting', description: 'Final launch go/no-go', priority: 'high', tags: [designTag, urgentTag] }),
      buildTodo({ title: 'Launch budget review', description: 'Finance sync', priority: 'high', tags: [financeTag] }),
      buildTodo({ title: 'Launch QA sweep', description: 'Regression testing', priority: 'medium', tags: [opsTag] })
    ];

    const filtered = filterTodos(todos, {
      query: 'launch',
      priority: 'high',
      tagIds: [urgentTag.id]
    });

    expect(filtered.map((todo) => todo.title)).toEqual(['Launch checklist meeting']);
  });
});
