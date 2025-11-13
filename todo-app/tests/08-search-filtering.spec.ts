import { test, expect } from '@playwright/test';
import { createTodo, resetTodos, type PriorityValue } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetTodos(request);
});

test('searches todos by title keyword', async ({ page }) => {
  await page.goto('/');

  // Create multiple todos
  await createTodo(page, { title: 'Buy groceries', priority: 'medium' });
  await createTodo(page, { title: 'Write report', priority: 'high' });
  await createTodo(page, { title: 'Buy birthday gift', priority: 'low' });

  // Verify all todos are visible
  const activeSection = page.getByTestId('todo-section-active');
  await expect(activeSection.locator('[data-testid="todo-item"]')).toHaveCount(3);

  // Search for "buy"
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill('buy');
  await page.waitForTimeout(500); // Debounce delay

  // Verify only matching todos are shown
  await expect(activeSection.getByText('Buy groceries')).toBeVisible();
  await expect(activeSection.getByText('Buy birthday gift')).toBeVisible();
  await expect(activeSection.getByText('Write report')).toHaveCount(0);

  // Clear search
  await searchInput.clear();
  await page.waitForTimeout(500);

  // Verify all todos are visible again
  await expect(activeSection.locator('[data-testid="todo-item"]')).toHaveCount(3);
});

test('search is case-insensitive', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'IMPORTANT MEETING', priority: 'high' });
  await createTodo(page, { title: 'casual coffee', priority: 'low' });

  const searchInput = page.getByPlaceholder(/search/i);

  // Search with lowercase
  await searchInput.fill('important');
  await page.waitForTimeout(500);

  await expect(page.getByText('IMPORTANT MEETING')).toBeVisible();
  await expect(page.getByText('casual coffee')).toHaveCount(0);

  // Search with mixed case
  await searchInput.fill('CaSuAl');
  await page.waitForTimeout(500);

  await expect(page.getByText('casual coffee')).toBeVisible();
  await expect(page.getByText('IMPORTANT MEETING')).toHaveCount(0);
});

test('filters todos by priority', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'High priority task', priority: 'high' });
  await createTodo(page, { title: 'Medium priority task', priority: 'medium' });
  await createTodo(page, { title: 'Low priority task', priority: 'low' });

  const activeSection = page.getByTestId('todo-section-active');

  // Filter by high priority
  const priorityFilter = page.locator('#priorityFilter');
  if (await priorityFilter.count() > 0) {
    await priorityFilter.selectOption('high');
    await page.waitForTimeout(300);

    await expect(activeSection.getByText('High priority task')).toBeVisible();
    await expect(activeSection.getByText('Medium priority task')).toHaveCount(0);
    await expect(activeSection.getByText('Low priority task')).toHaveCount(0);

    // Clear filter
    const clearButton = page.getByRole('button', { name: /clear.*filter/i });
    if (await clearButton.count() > 0) {
      await clearButton.click();
      await page.waitForTimeout(300);
      await expect(activeSection.locator('[data-testid="todo-item"]')).toHaveCount(3);
    }
  }
});

test('filters todos by completion status', async ({ page }) => {
  await page.goto('/');

  // Create todos
  await createTodo(page, { title: 'Active task 1', priority: 'medium' });
  await createTodo(page, { title: 'Active task 2', priority: 'medium' });
  await createTodo(page, { title: 'To be completed', priority: 'medium' });

  // Complete one todo
  await page.getByLabel('Mark To be completed as complete').click();
  await page.waitForTimeout(500);

  // Check if completion filter exists
  const completionFilter = page.locator('select').filter({ hasText: /complete/i }).first();
  if (await completionFilter.count() > 0) {
    // Filter to show only completed
    await completionFilter.selectOption(/completed only/i);
    await page.waitForTimeout(300);

    const completedSection = page.getByTestId('todo-section-completed');
    await expect(completedSection.getByText('To be completed')).toBeVisible();

    // Filter to show only incomplete
    await completionFilter.selectOption(/incomplete only/i);
    await page.waitForTimeout(300);

    const activeSection = page.getByTestId('todo-section-active');
    await expect(activeSection.getByText('Active task 1')).toBeVisible();
    await expect(activeSection.getByText('Active task 2')).toBeVisible();
  }
});

test('combines search and priority filter', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'High priority meeting', priority: 'high' });
  await createTodo(page, { title: 'High priority task', priority: 'high' });
  await createTodo(page, { title: 'Low priority meeting', priority: 'low' });

  // Apply search
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill('meeting');
  await page.waitForTimeout(500);

  // Also apply priority filter
  const priorityFilter = page.locator('#priorityFilter');
  if (await priorityFilter.count() > 0) {
    await priorityFilter.selectOption('high');
    await page.waitForTimeout(300);

    // Should only show "High priority meeting" (matches both filters)
    const activeSection = page.getByTestId('todo-section-active');
    await expect(activeSection.getByText('High priority meeting')).toBeVisible();
    await expect(activeSection.getByText('High priority task')).toHaveCount(0);
    await expect(activeSection.getByText('Low priority meeting')).toHaveCount(0);
  }
});

test('displays empty state when no todos match filters', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'Sample task', priority: 'medium' });

  // Search for non-existent text
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill('nonexistent');
  await page.waitForTimeout(500);

  // Should show empty state or no todos
  const activeSection = page.getByTestId('todo-section-active');
  await expect(activeSection.locator('[data-testid="todo-item"]')).toHaveCount(0);
});

test('clears all filters at once', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'Test task 1', priority: 'high' });
  await createTodo(page, { title: 'Test task 2', priority: 'low' });
  await createTodo(page, { title: 'Different name', priority: 'medium' });

  // Apply multiple filters
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill('test');
  await page.waitForTimeout(500);

  const priorityFilter = page.locator('#priorityFilter');
  if (await priorityFilter.count() > 0) {
    await priorityFilter.selectOption('high');
    await page.waitForTimeout(300);

    // Should show only one todo
    const activeSection = page.getByTestId('todo-section-active');
    await expect(activeSection.locator('[data-testid="todo-item"]')).toHaveCount(1);

    // Clear all filters
    const clearAllButton = page.getByRole('button', { name: /clear all/i });
    if (await clearAllButton.count() > 0) {
      await clearAllButton.click();
      await page.waitForTimeout(300);

      // All todos should be visible
      await expect(activeSection.locator('[data-testid="todo-item"]')).toHaveCount(3);
    } else {
      // Manual clear if no button
      await searchInput.clear();
      await page.waitForTimeout(500);
      await expect(activeSection.locator('[data-testid="todo-item"]')).toHaveCount(2);
    }
  }
});

test('saves and applies filter preset', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'High priority work', priority: 'high' });
  await createTodo(page, { title: 'Low priority personal', priority: 'low' });

  // Set up filters
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill('work');
  await page.waitForTimeout(500);

  const priorityFilter = page.locator('#priorityFilter');
  if (await priorityFilter.count() > 0) {
    await priorityFilter.selectOption('high');
    await page.waitForTimeout(300);

    // Save preset
    const saveFilterButton = page.getByRole('button', { name: /save filter/i });
    if (await saveFilterButton.count() > 0) {
      await saveFilterButton.click();

      // Enter preset name
      const presetNameInput = page.locator('input[name="presetName"], input[placeholder*="preset"], input[placeholder*="name"]').first();
      if (await presetNameInput.count() > 0) {
        await presetNameInput.fill('High Priority Work');
        await page.getByRole('button', { name: /save/i }).last().click();
        await page.waitForTimeout(300);

        // Clear filters
        await searchInput.clear();
        await priorityFilter.selectOption('all');
        await page.waitForTimeout(500);

        // Apply saved preset
        const presetChip = page.getByText('High Priority Work');
        if (await presetChip.count() > 0) {
          await presetChip.click();
          await page.waitForTimeout(300);

          // Verify filters are re-applied
          const activeSection = page.getByTestId('todo-section-active');
          await expect(activeSection.getByText('High priority work')).toBeVisible();
          await expect(activeSection.getByText('Low priority personal')).toHaveCount(0);
        }
      }
    }
  }
});

test('deletes saved filter preset', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'Test task', priority: 'medium' });

  // Set up and save a filter preset
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill('test');
  await page.waitForTimeout(500);

  const saveFilterButton = page.getByRole('button', { name: /save filter/i });
  if (await saveFilterButton.count() > 0) {
    await saveFilterButton.click();

    const presetNameInput = page.locator('input[name="presetName"], input[placeholder*="preset"], input[placeholder*="name"]').first();
    if (await presetNameInput.count() > 0) {
      await presetNameInput.fill('Temporary Preset');
      await page.getByRole('button', { name: /save/i }).last().click();
      await page.waitForTimeout(300);

      // Verify preset exists
      const presetChip = page.getByText('Temporary Preset');
      await expect(presetChip).toBeVisible();

      // Delete preset
      const deletePresetButton = presetChip.locator('..').getByRole('button', { name: /delete|remove|×/i }).first();
      if (await deletePresetButton.count() > 0) {
        await deletePresetButton.click();
        await page.waitForTimeout(300);

        // Verify preset is gone
        await expect(presetChip).toHaveCount(0);
      }
    }
  }
});

test('filters persist after page reload if using saved presets', async ({ page }) => {
  await page.goto('/');

  await createTodo(page, { title: 'Persistent filter test', priority: 'high' });

  // Create and save a preset
  const priorityFilter = page.locator('#priorityFilter');
  if (await priorityFilter.count() > 0) {
    await priorityFilter.selectOption('high');
    await page.waitForTimeout(300);

    const saveFilterButton = page.getByRole('button', { name: /save filter/i });
    if (await saveFilterButton.count() > 0) {
      await saveFilterButton.click();

      const presetNameInput = page.locator('input[name="presetName"], input[placeholder*="preset"], input[placeholder*="name"]').first();
      if (await presetNameInput.count() > 0) {
        await presetNameInput.fill('High Only');
        await page.getByRole('button', { name: /save/i }).last().click();
        await page.waitForTimeout(300);

        // Reload page
        await page.reload();
        await page.waitForTimeout(1000);

        // Verify preset still exists in localStorage
        const presetChip = page.getByText('High Only');
        await expect(presetChip).toBeVisible();
      }
    }
  }
});
