import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTodo, resetTodos } from './helpers';

async function writeTempJson(data: unknown): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-import-'));
  const filePath = path.join(tempDir, 'payload.json');
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return {
    filePath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

test.beforeEach(async ({ request }) => {
  await resetTodos(request);
});

test('exports current todos to downloadable JSON', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, {
    title: 'Export candidate',
    description: 'Todo that should appear in export',
    priority: 'high'
  });

  await page.getByRole('button', { name: 'Export Data' }).click();
  const exportJsonButton = page.getByRole('button', { name: 'JSON', exact: true });
  await expect(exportJsonButton).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportJsonButton.click()
  ]);

  await expect(page.getByText('Export completed successfully.')).toBeVisible();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-export-'));
  try {
    const suggested = download.suggestedFilename() || 'todos-export.json';
    expect(suggested.endsWith('.json')).toBe(true);
    const exportPath = path.join(tempDir, suggested);
    await download.saveAs(exportPath);
    const contents = await fs.readFile(exportPath, 'utf8');
    const data = JSON.parse(contents) as {
      version: string;
      todos?: Array<{ title?: string }>;
      tags?: unknown[];
    };

    expect(data.version).toBe('1.0.0');
    expect(Array.isArray(data.todos)).toBe(true);
    expect(data.todos).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Export candidate' })])
    );
    expect(Array.isArray(data.tags)).toBe(true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('exports current todos to downloadable CSV', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, {
    title: 'CSV export candidate',
    description: 'Todo exported as CSV',
    priority: 'medium'
  });

  await page.getByRole('button', { name: 'Export Data' }).click();
  const exportCsvButton = page.getByRole('button', { name: 'CSV', exact: true });
  await expect(exportCsvButton).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportCsvButton.click()
  ]);

  await expect(page.getByText('CSV export completed successfully.')).toBeVisible();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-export-csv-'));
  try {
    const suggested = download.suggestedFilename() || 'todos-export.csv';
    expect(suggested.endsWith('.csv')).toBe(true);
    const exportPath = path.join(tempDir, suggested);
    await download.saveAs(exportPath);
    const contents = await fs.readFile(exportPath, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines[0]).toContain('tag_names');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]).toContain('CSV export candidate');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('imports a JSON backup and restores todos, subtasks, and tags', async ({ page }) => {
  await page.goto('/');

  const tagName = `Imported Tag ${Math.random().toString(16).slice(2)}`;
  const payload = {
    version: '1.0.0',
    exported_at: '2024-01-01T00:00:00.000+08:00',
    tags: [
      {
        id: 1,
        name: tagName,
        color: '#34D399',
        created_at: '2024-01-01T00:00:00.000+08:00',
        updated_at: '2024-01-01T00:00:00.000+08:00'
      }
    ],
    todos: [
      {
        id: 10,
        title: 'Imported todo sample',
        description: 'Restored from JSON',
        priority: 'medium',
        is_completed: false,
        due_date: '2024-02-01T09:00:00.000+08:00',
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: 60,
        created_at: '2024-01-01T00:00:00.000+08:00',
        updated_at: '2024-01-01T00:00:00.000+08:00',
        subtasks: [
          {
            id: 99,
            title: 'Imported subtask',
            position: 0,
            is_completed: false,
            created_at: '2024-01-01T00:00:00.000+08:00',
            updated_at: '2024-01-01T00:00:00.000+08:00'
          }
        ],
        tagIds: [1]
      }
    ]
  };

  const { filePath, cleanup } = await writeTempJson(payload);
  try {
    await page.locator('input[type="file"][accept="application/json"]').setInputFiles(filePath);

    await expect(
      page.getByText(/Imported 1 todos and 1 subtasks \(1 tags created, 0 reused\)\./)
    ).toBeVisible();

    const todoItem = page.locator('[data-testid="todo-item"]', {
      hasText: 'Imported todo sample'
    }).first();
    await expect(todoItem).toBeVisible();
    await expect(todoItem.getByLabel(`Tag ${tagName}`)).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('reuses existing tags when importing matching names', async ({ page, request }) => {
  await page.goto('/');

  const sharedTagName = `Reusable Tag ${Math.random().toString(16).slice(2)}`;
  const basePayload = {
    version: '1.0.0',
    exported_at: '2024-01-01T00:00:00.000+08:00',
    tags: [
      {
        id: 5,
        name: sharedTagName,
        color: '#6366F1',
        created_at: '2024-01-01T00:00:00.000+08:00',
        updated_at: '2024-01-01T00:00:00.000+08:00'
      }
    ],
    todos: [
      {
        id: 55,
        title: 'Seeded todo for reuse',
        priority: 'low',
        is_completed: false,
        due_date: null,
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: null,
        created_at: '2024-01-01T00:00:00.000+08:00',
        updated_at: '2024-01-01T00:00:00.000+08:00',
        subtasks: [],
        tagIds: [5]
      }
    ]
  };

  const firstImport = await writeTempJson(basePayload);
  try {
    await page.locator('input[type="file"][accept="application/json"]').setInputFiles(firstImport.filePath);
    await expect(
      page.getByText(/Imported 1 todos and 0 subtasks \(1 tags created, 0 reused\)\./)
    ).toBeVisible();
  } finally {
    await firstImport.cleanup();
  }

  await resetTodos(request);
  await page.reload();

  const followUpPayload = {
    ...basePayload,
    todos: [
      {
        id: 77,
        title: 'Todo referencing existing tag',
        priority: 'medium',
        is_completed: false,
        due_date: null,
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: null,
        created_at: '2024-01-01T00:00:00.000+08:00',
        updated_at: '2024-01-01T00:00:00.000+08:00',
        subtasks: [],
        tagIds: [42]
      }
    ],
    tags: [
      {
        id: 42,
        name: sharedTagName,
        color: '#6366F1',
        created_at: '2024-01-02T00:00:00.000+08:00',
        updated_at: '2024-01-02T00:00:00.000+08:00'
      }
    ]
  };

  const secondImport = await writeTempJson(followUpPayload);
  try {
    await page.locator('input[type="file"][accept="application/json"]').setInputFiles(secondImport.filePath);

    await expect(
      page.getByText(/Imported 1 todos and 0 subtasks \(0 tags created, 1 reused\)\./)
    ).toBeVisible();

    const todoItem = page.locator('[data-testid="todo-item"]', {
      hasText: 'Todo referencing existing tag'
    }).first();
    await expect(todoItem).toBeVisible();
    await expect(todoItem.getByLabel(`Tag ${sharedTagName}`)).toBeVisible();
  } finally {
    await secondImport.cleanup();
  }
});
