import { test, expect } from '@playwright/test';
import { createTodo, resetTodos, type PriorityValue } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetTodos(request);
});

test('creates todos with each priority and displays matching badges', async ({ page }) => {
  await page.goto('/');

  const priorities: PriorityValue[] = ['high', 'medium', 'low'];

  for (const priority of priorities) {
    await createTodo(page, {
      title: `${priority} priority task`,
      description: `Task set to ${priority}`,
      priority
    });
  }

  for (const priority of priorities) {
    const badge = page.getByTestId(`priority-badge-${priority}`).first();
    await expect(badge).toHaveAttribute('aria-label', new RegExp(priority, 'i'));
  }
});

test('sorts todos by priority then due date then creation time', async ({ page }) => {
  await page.goto('/');

  const priorities: PriorityValue[] = ['medium', 'high', 'low'];
  for (const priority of priorities) {
    await createTodo(page, {
      title: `${priority} priority order test`,
      priority
    });
  }

  const items = page.locator('[data-testid="todo-section-active"] [data-testid="todo-item"]');
  await expect(items).toHaveCount(3);

  const prioritiesRendered = await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-priority')));
  expect(prioritiesRendered).toEqual(['high', 'medium', 'low']);
});

test('filters todos by priority using the filter dropdown', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'Filter high', priority: 'high' });
  await createTodo(page, { title: 'Filter low', priority: 'low' });

  const section = page.getByTestId('todo-section-active');
  await expect(section.locator('[data-testid="todo-item"]')).toHaveCount(2);

  await page.selectOption('#priorityFilter', 'high');
  await expect(section.locator('[data-testid="todo-item"]')).toHaveCount(1);
  await expect(section.getByText('Filter high')).toBeVisible();
  await expect(section.getByText('Filter low')).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear priority filter' }).click();
  await expect(section.locator('[data-testid="todo-item"]')).toHaveCount(2);
});

test('priority persists when editing a todo', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'Editable todo', priority: 'low' });

  const editButton = page.getByRole('button', { name: 'Edit' }).first();
  await editButton.click();

  await page.getByRole('dialog').locator('select[name="priority"]').selectOption('high');

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/todos/') && response.request().method() === 'PUT' && response.status() === 200
    ),
    page.getByRole('button', { name: 'Save Changes' }).click()
  ]);

  await expect(page.getByRole('dialog')).toBeHidden();

  const todoItem = page.locator('[data-testid="todo-item"]', { hasText: 'Editable todo' }).first();
  await expect(todoItem).toHaveAttribute('data-priority', 'high');
});
