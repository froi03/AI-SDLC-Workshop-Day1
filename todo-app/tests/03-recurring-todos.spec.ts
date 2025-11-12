import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { resetTodos } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetTodos(request);
});

interface ApiTodo {
  id: number;
  title: string;
  dueDate: string | null;
  isCompleted: boolean;
  isRecurring: boolean;
  recurrencePattern: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  reminderMinutes: number | null;
}

function futureDatetimeLocal(options: { days?: number; hours?: number } = {}): string {
  const { days = 0, hours = 0 } = options;
  return DateTime.now()
    .setZone('Asia/Singapore')
    .plus({ days, hours, minutes: 5 })
    .toFormat("yyyy-LL-dd'T'HH:mm");
}

test('requires a due date before enabling recurrence', async ({ page, request }) => {
  await page.goto('/');

  await page.getByLabel('Title').fill('Recurring without due date');
  await page.getByLabel('Repeat this todo').check();

  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/todos') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Create Todo' }).click();
  const response = await responsePromise;

  expect(response.status()).toBe(400);
  await expect(page.getByText('Recurring todos require a due date')).toBeVisible();

  const todosResponse = await request.get('/api/todos');
  const todosData = (await todosResponse.json()) as { todos?: ApiTodo[] };
  expect(todosData.todos ?? []).toHaveLength(0);
});

test('completing a recurring todo generates the next occurrence', async ({ page, request }) => {
  await page.goto('/');

  const title = 'Daily recurring task';
  const dueDateValue = futureDatetimeLocal({ hours: 2 });

  await page.getByLabel('Title').fill(title);
  await page.fill('#dueDate', dueDateValue);
  await page.getByLabel('Repeat this todo').check();
  await page.selectOption('#recurrencePattern', 'daily');
  await page.selectOption('#reminderMinutes', '60');

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  const listResponse = await request.get('/api/todos');
  const listData = (await listResponse.json()) as { todos?: ApiTodo[] };
  const created = (listData.todos ?? []).find((todo) => todo.title === title && !todo.isCompleted);
  expect(created).toBeDefined();
  expect(created?.dueDate).not.toBeNull();

  await expect(page.getByTestId('todo-section-active').getByText(title)).toBeVisible();
  await expect(page.getByTestId('todo-section-active').getByText('Repeats daily')).toBeVisible();
  await expect(page.getByTestId('todo-section-active').getByText('Reminder 60m')).toBeVisible();

  const toggleResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/todos/${created?.id}`) && response.request().method() === 'PUT' && response.status() === 200
  );
  await page.getByLabel(`Mark ${title} as complete`).click();
  await toggleResponsePromise;

  const afterResponse = await request.get('/api/todos');
  const afterData = (await afterResponse.json()) as { todos?: ApiTodo[] };
  const todos = afterData.todos ?? [];

  const completed = todos.find((todo) => todo.id === created?.id);
  expect(completed?.isCompleted).toBe(true);

  const successor = todos.find((todo) => todo.id !== created?.id && todo.title === title && !todo.isCompleted);
  expect(successor).toBeDefined();
  expect(successor?.isRecurring).toBe(true);
  expect(successor?.recurrencePattern).toBe('daily');
  expect(successor?.reminderMinutes).toBe(60);

  const expectedNextDueDate = DateTime.fromISO(created!.dueDate!)
    .setZone('Asia/Singapore')
    .plus({ days: 1 })
    .toUTC()
    .toISO();
  expect(successor?.dueDate).toBe(expectedNextDueDate);

  await expect(page.getByTestId('todo-section-completed').getByText(title)).toBeVisible();
  await expect(page.getByLabel(`Mark ${title} as incomplete`)).toBeVisible();
  await expect(page.getByLabel(`Mark ${title} as complete`)).toBeVisible();
});
