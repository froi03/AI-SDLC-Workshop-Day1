import { test, expect } from '@playwright/test';
import { resetTodos, type PriorityValue } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetTodos(request);
});

test('creates a todo with just a title', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Title').fill('Simple todo');
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  const section = page.getByTestId('todo-section-active');
  await expect(section.getByText('Simple todo')).toBeVisible();
});

test('creates a todo with all fields filled', async ({ page }) => {
  await page.goto('/');

  // Fill all fields
  await page.getByLabel('Title').fill('Complete todo');
  await page.getByLabel('Description').fill('This has all fields');
  await page.selectOption('#priority', 'high');

  // Set due date (tomorrow at 2 PM Singapore time)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateString = tomorrow.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm
  await page.locator('input[type="datetime-local"]').fill(dateString);

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  // Verify todo appears with all details
  const section = page.getByTestId('todo-section-active');
  await expect(section.getByText('Complete todo')).toBeVisible();
  await expect(page.getByTestId('priority-badge-high').first()).toBeVisible();
});

test('lists todos in correct sections', async ({ page }) => {
  await page.goto('/');

  // Create an active todo (no due date)
  await page.getByLabel('Title').fill('Active task');
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  // Verify it appears in active section
  const activeSection = page.getByTestId('todo-section-active');
  await expect(activeSection.getByText('Active task')).toBeVisible();

  // Complete the todo
  await page.getByLabel('Mark Active task as complete').click();

  // Verify it moves to completed section
  const completedSection = page.getByTestId('todo-section-completed');
  await expect(completedSection.getByText('Active task')).toBeVisible();
});

test('updates a todo', async ({ page }) => {
  await page.goto('/');

  // Create initial todo
  await page.getByLabel('Title').fill('Original title');
  await page.selectOption('#priority', 'low');
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  // Click edit
  const editButton = page.getByRole('button', { name: 'Edit' }).first();
  await editButton.click();

  // Update fields
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="title"]').fill('Updated title');
  await dialog.locator('textarea[name="description"]').fill('Added description');
  await dialog.locator('select[name="priority"]').selectOption('high');

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/todos/') && response.request().method() === 'PUT' && response.status() === 200
    ),
    page.getByRole('button', { name: 'Save Changes' }).click()
  ]);

  // Verify changes
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Updated title')).toBeVisible();
  await expect(page.getByText('Added description')).toBeVisible();
  const todoItem = page.locator('[data-testid="todo-item"]', { hasText: 'Updated title' }).first();
  await expect(todoItem).toHaveAttribute('data-priority', 'high');
});

test('toggles todo completion status', async ({ page }) => {
  await page.goto('/');

  // Create todo
  await page.getByLabel('Title').fill('Toggle me');
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  // Mark as complete
  await page.getByLabel('Mark Toggle me as complete').click();
  await page.waitForTimeout(500); // Wait for state update

  // Verify in completed section
  const completedSection = page.getByTestId('todo-section-completed');
  await expect(completedSection.getByText('Toggle me')).toBeVisible();

  // Mark as incomplete
  await page.getByLabel('Mark Toggle me as incomplete').click();
  await page.waitForTimeout(500); // Wait for state update

  // Verify back in active section
  const activeSection = page.getByTestId('todo-section-active');
  await expect(activeSection.getByText('Toggle me')).toBeVisible();
});

test('deletes a todo', async ({ page }) => {
  await page.goto('/');

  // Create todo
  await page.getByLabel('Title').fill('To be deleted');
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  // Verify it exists
  await expect(page.getByText('To be deleted')).toBeVisible();

  // Delete the todo
  const deleteButton = page.getByRole('button', { name: 'Delete' }).first();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/todos/') && response.request().method() === 'DELETE' && response.status() === 200
    ),
    deleteButton.click()
  ]);

  // Verify it's gone
  await expect(page.getByText('To be deleted')).toHaveCount(0);
});

test('validates empty title on create', async ({ page }) => {
  await page.goto('/');

  // Try to create with empty title
  await page.getByLabel('Title').fill('   '); // Just whitespace
  await page.getByRole('button', { name: 'Create Todo' }).click();

  // Should not create todo - wait a bit and verify no API call was successful
  await page.waitForTimeout(500);

  // Check that active section is empty or doesn't exist
  const activeSection = page.getByTestId('todo-section-active');
  const todoItems = activeSection.locator('[data-testid="todo-item"]');
  await expect(todoItems).toHaveCount(0);
});

test('sorts todos by priority within active section', async ({ page }) => {
  await page.goto('/');

  // Create todos in mixed priority order
  const priorities: Array<{ title: string; priority: PriorityValue }> = [
    { title: 'Low priority', priority: 'low' },
    { title: 'High priority', priority: 'high' },
    { title: 'Medium priority', priority: 'medium' }
  ];

  for (const { title, priority } of priorities) {
    await page.getByLabel('Title').fill(title);
    await page.selectOption('#priority', priority);
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
      ),
      page.getByRole('button', { name: 'Create Todo' }).click()
    ]);
  }

  // Check they are sorted: high, medium, low
  const items = page.locator('[data-testid="todo-section-active"] [data-testid="todo-item"]');
  await expect(items).toHaveCount(3);

  const renderedOrder = await items.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-priority'))
  );
  expect(renderedOrder).toEqual(['high', 'medium', 'low']);
});

test('persists todos after page reload', async ({ page }) => {
  await page.goto('/');

  // Create a todo
  await page.getByLabel('Title').fill('Persistent todo');
  await page.selectOption('#priority', 'high');
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  // Verify it exists
  await expect(page.getByText('Persistent todo')).toBeVisible();

  // Reload the page
  await page.reload();

  // Verify the todo still exists after reload
  await expect(page.getByText('Persistent todo')).toBeVisible();
  await expect(page.getByTestId('priority-badge-high').first()).toBeVisible();
});
