import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { resetTodos } from './helpers';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function createTodoWithDueDate(request: APIRequestContext, args: { title: string; dueDateIso: string }) {
  const response = await request.post('/api/todos', {
    data: {
      title: args.title,
      description: 'Calendar scenario',
      priority: 'high',
      dueDate: args.dueDateIso,
      isRecurring: false,
      reminderMinutes: 60
    }
  });

  expect(response.status()).toBe(201);
}

async function waitForCalendarFetches(page: Page) {
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/todos') && response.request().method() === 'GET'),
    page.waitForResponse((response) => response.url().includes('/api/holidays') && response.request().method() === 'GET')
  ]);
}

test.beforeEach(async ({ request }) => {
  await resetTodos(request);
});

test('renders calendar grid and supports month navigation', async ({ page }) => {
  await Promise.all([waitForCalendarFetches(page), page.goto('/calendar')]);

  const monthLabel = await page.getByTestId('calendar-month-label').textContent();
  expect(monthLabel).toBeTruthy();

  for (const label of WEEKDAYS) {
    await expect(page.getByTestId('calendar-weekdays').getByText(label)).toBeVisible();
  }

  await Promise.all([waitForCalendarFetches(page), page.getByTestId('calendar-next').click()]);
  const nextLabel = await page.getByTestId('calendar-month-label').textContent();
  expect(nextLabel).toBeTruthy();
  expect(nextLabel).not.toBe(monthLabel);

  await Promise.all([waitForCalendarFetches(page), page.getByTestId('calendar-prev').click()]);
  const restoredLabel = await page.getByTestId('calendar-month-label').textContent();
  expect(restoredLabel).toBe(monthLabel);

  await page.getByTestId('calendar-today').click();
  await expect(page.getByTestId('calendar-grid').locator('span', { hasText: 'Today' }).first()).toBeVisible();
});

test('opens day modal showing todos due on selected date', async ({ page, request }) => {
  const now = DateTime.now().setZone('Asia/Singapore');
  let target = now.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  if (target.month !== now.month) {
    target = now.plus({ months: 1 }).startOf('month').plus({ days: 2 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  }

  const targetMonthDiff = Math.round(
    target.startOf('month').diff(now.startOf('month'), 'months').months
  );

  await createTodoWithDueDate(request, {
    title: 'Calendar view todo',
    dueDateIso: target.toISO() ?? now.plus({ days: 1 }).toISO()!
  });

  await Promise.all([waitForCalendarFetches(page), page.goto('/calendar')]);

  for (let index = 0; index < targetMonthDiff; index += 1) {
    await Promise.all([waitForCalendarFetches(page), page.getByTestId('calendar-next').click()]);
  }

  const dateKey = target.toISODate();
  if (!dateKey) {
    throw new Error('Failed to derive calendar target date');
  }

  const dayCell = page.getByTestId(`calendar-day-${dateKey}`);
  await expect(dayCell).toBeVisible();

  await dayCell.click();
  const modal = page.getByTestId('calendar-day-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Calendar view todo')).toBeVisible();
  await expect(modal.getByText(/Reminder/)).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(modal).not.toBeVisible();
});
