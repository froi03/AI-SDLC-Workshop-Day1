import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

const TEST_USER_ID = 1;

function toUtcIso(dateTime: DateTime): string {
  const iso = dateTime.toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to convert DateTime to ISO string');
  }
  return iso;
}

test.describe('Reminder notifications', () => {
  const createdTodoIds: number[] = [];

  test.afterEach(() => {
    if (createdTodoIds.length === 0) {
      return;
    }

    const uniqueIds = Array.from(new Set(createdTodoIds));
    for (const todoId of uniqueIds) {
      todoDB.delete(todoId, TEST_USER_ID);
    }

    createdTodoIds.length = 0;
  });

  test('listReminderCandidates excludes completed and reminderless todos', () => {
    const nowSingapore = getSingaporeNow();
    const dueWithReminder = toUtcIso(nowSingapore.plus({ hours: 1 }));
    const dueWithoutReminder = toUtcIso(nowSingapore.plus({ hours: 2 }));

    const reminderTodo = todoDB.create({
      userId: TEST_USER_ID,
      title: `Reminder candidate ${Date.now()}`,
      description: 'Integration check',
      priority: 'medium',
      dueDate: dueWithReminder,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: 30
    });
    createdTodoIds.push(reminderTodo.id);

    const completedTodo = todoDB.create({
      userId: TEST_USER_ID,
      title: `Completed ${Date.now()}`,
      description: 'Should be excluded',
      priority: 'low',
      dueDate: dueWithReminder,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: 15
    });
    createdTodoIds.push(completedTodo.id);
    todoDB.update(completedTodo.id, TEST_USER_ID, {
      isCompleted: true,
      completedAt: toUtcIso(getSingaporeNow())
    });

    const noReminderTodo = todoDB.create({
      userId: TEST_USER_ID,
      title: `No reminder ${Date.now()}`,
      description: 'Missing reminder offset',
      priority: 'high',
      dueDate: dueWithoutReminder,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: null
    });
    createdTodoIds.push(noReminderTodo.id);

    const candidateIds = new Set(todoDB.listReminderCandidates(TEST_USER_ID).map((todo) => todo.id));

    expect(candidateIds.has(reminderTodo.id)).toBeTruthy();
    expect(candidateIds.has(completedTodo.id)).toBeFalsy();
    expect(candidateIds.has(noReminderTodo.id)).toBeFalsy();
  });

  test('markNotificationsSent stamps last_notification_sent and persists', () => {
    const dueDate = toUtcIso(getSingaporeNow().plus({ minutes: 45 }));

    const reminderTodo = todoDB.create({
      userId: TEST_USER_ID,
      title: `Mark reminder ${Date.now()}`,
      description: 'Verify timestamp persistence',
      priority: 'medium',
      dueDate,
      isRecurring: false,
      recurrencePattern: null,
      reminderMinutes: 15
    });
    createdTodoIds.push(reminderTodo.id);

    const sentAt = toUtcIso(DateTime.now().setZone('Asia/Singapore'));

    todoDB.markNotificationsSent(TEST_USER_ID, [reminderTodo.id], sentAt);

    const updated = todoDB.getById(reminderTodo.id, TEST_USER_ID);
    expect(updated).toBeDefined();
    expect(updated?.lastNotificationSent).toBe(sentAt);
    expect(updated?.updatedAt).toBeDefined();
    expect(updated?.createdAt).toBeDefined();
    if (updated?.updatedAt && updated?.createdAt) {
      expect(DateTime.fromISO(updated.updatedAt) >= DateTime.fromISO(updated.createdAt)).toBeTruthy();
    }
  });
});
