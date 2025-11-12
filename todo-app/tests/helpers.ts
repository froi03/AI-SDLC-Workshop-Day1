import { expect, type APIRequestContext, type Page } from '@playwright/test';

export type PriorityValue = 'high' | 'medium' | 'low';

export async function resetTodos(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/todos', { failOnStatusCode: false });
  if (!response.ok()) {
    throw new Error(`Failed to fetch todos for reset: ${response.status()}`);
  }

  const data = (await response.json()) as { todos?: Array<{ id: number }> };
  const todos = data.todos ?? [];

  await Promise.all(
    todos.map((todo) => request.delete(`/api/todos/${todo.id}`, { failOnStatusCode: false }))
  );
}

interface CreateTodoOptions {
  title: string;
  description?: string;
  priority: PriorityValue;
}

export async function createTodo(page: Page, options: CreateTodoOptions): Promise<void> {
  await page.getByLabel('Title').fill(options.title);

  if (options.description) {
    await page.getByLabel('Description').fill(options.description);
  }

  await page.selectOption('#priority', options.priority);

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/todos') && response.request().method() === 'POST' && response.status() === 201
    ),
    page.getByRole('button', { name: 'Create Todo' }).click()
  ]);

  await expect(page.getByTestId(`priority-badge-${options.priority}`).first()).toBeVisible();
}
