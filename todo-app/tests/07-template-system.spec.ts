import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { tagDB, templateDB, todoDB } from '@/lib/db';

const TEST_USER_ID = 1;

const createdTagIds: number[] = [];
const createdTemplateIds: number[] = [];
const createdTodoIds: number[] = [];

function registerTagCleanup(tagId: number) {
  createdTagIds.push(tagId);
}

function registerTemplateCleanup(templateId: number) {
  createdTemplateIds.push(templateId);
}

function registerTodoCleanup(todoId: number) {
  createdTodoIds.push(todoId);
}

test.afterEach(() => {
  for (const todoId of createdTodoIds.splice(0)) {
    todoDB.delete(todoId, TEST_USER_ID);
  }
  for (const templateId of createdTemplateIds.splice(0)) {
    templateDB.delete(templateId, TEST_USER_ID);
  }
  for (const tagId of createdTagIds.splice(0)) {
    try {
      tagDB.delete(tagId, TEST_USER_ID);
    } catch (error) {
      // Tag may have been deleted during the test
    }
  }
});

function createTag(name: string, color = '#3B82F6') {
  const tag = tagDB.create(TEST_USER_ID, { name, color });
  registerTagCleanup(tag.id);
  return tag;
}

test.describe('Template system database helpers', () => {
  test('templateDB.create normalises metadata, tags, and subtasks', () => {
    const tag = createTag(`Focus-${Date.now()}`);

    const template = templateDB.create(TEST_USER_ID, {
      name: '  Weekly Prep  ',
      description: '  Wrap up tasks  ',
      category: '  Work  ',
      todoTitle: ' Weekly prep checklist  ',
      todoDescription: '  consolidate updates  ',
      priority: 'high',
      recurrencePattern: 'weekly',
      reminderMinutes: 120,
      dueOffsetDays: 3,
      tagIds: [tag.id],
      subtasks: [
        { title: ' Document highlights ', position: 3 },
        { title: ' Review blockers', position: 1 },
        { title: 'Coordinate follow-ups', position: 5 },
        { title: ' ', position: 2 }
      ],
      estimatedDurationMinutes: null
    });

    registerTemplateCleanup(template.id);

    expect(template.name).toBe('Weekly Prep');
    expect(template.description).toBe('Wrap up tasks');
    expect(template.category).toBe('Work');
    expect(template.todoTitle).toBe('Weekly prep checklist');
    expect(template.todoDescription).toBe('consolidate updates');
    expect(template.priority).toBe('high');
    expect(template.recurrencePattern).toBe('weekly');
    expect(template.reminderMinutes).toBe(120);
    expect(template.dueOffsetDays).toBe(3);
    expect(template.tagIds).toEqual([tag.id]);

    const subtaskTitles = template.subtasks.map((entry) => entry.title);
    expect(subtaskTitles).toEqual(['Review blockers', 'Document highlights', 'Coordinate follow-ups']);
    expect(template.subtasks.map((entry) => entry.position)).toEqual([1, 2, 3]);
  });

  test('templateDB.use creates a todo with metadata, tags, and subtasks applied', () => {
    const tag = createTag(`Apply-${Date.now()}`);
    const template = templateDB.create(TEST_USER_ID, {
      name: 'Sprint Retro',
      description: 'Sprint retrospective routine',
      category: 'Team',
      todoTitle: 'Sprint Retrospective',
      todoDescription: 'Discuss wins and action items',
      priority: 'medium',
      recurrencePattern: null,
      reminderMinutes: 30,
      dueOffsetDays: 0,
      tagIds: [tag.id],
      subtasks: [
        { title: 'Collect feedback', position: 2 },
        { title: 'Share agenda', position: 1 }
      ],
      estimatedDurationMinutes: null
    });
    registerTemplateCleanup(template.id);

    const singaporeDueIso = DateTime.now().setZone('Asia/Singapore').plus({ hours: 4 }).toISO();
    const expectedDueUtc = DateTime.fromISO(singaporeDueIso!, { zone: 'Asia/Singapore' }).toUTC().toISO();

    const { todo, missingTagIds } = templateDB.use(template.id, TEST_USER_ID, {
      dueDate: singaporeDueIso ?? undefined
    });

    registerTodoCleanup(todo.id);

    expect(todo.title).toBe('Sprint Retrospective');
    expect(todo.description).toBe('Discuss wins and action items');
    expect(todo.priority).toBe('medium');
    expect(todo.dueDate).toBe(expectedDueUtc);
    expect(todo.tags.map((entry) => entry.id)).toEqual([tag.id]);
    expect(todo.subtasks.map((entry) => entry.title)).toEqual(['Share agenda', 'Collect feedback']);
    expect(todo.subtasks.map((entry) => entry.position)).toEqual([1, 2]);
    expect(missingTagIds).toEqual([]);
  });

  test('templateDB.use reports missing tags when references are stale', () => {
    const tag = createTag(`Stale-${Date.now()}`);
    const template = templateDB.create(TEST_USER_ID, {
      name: 'Quarterly Review',
      description: null,
      category: null,
      todoTitle: 'Quarterly Business Review',
      todoDescription: '',
      priority: 'medium',
      recurrencePattern: null,
      reminderMinutes: null,
      dueOffsetDays: 1,
      tagIds: [tag.id],
      subtasks: [{ title: 'Compile KPIs', position: 1 }],
      estimatedDurationMinutes: null
    });
    registerTemplateCleanup(template.id);

    tagDB.delete(tag.id, TEST_USER_ID);

    const { todo, missingTagIds } = templateDB.use(template.id, TEST_USER_ID, {
      dueOffsetDays: 0
    });

    registerTodoCleanup(todo.id);

    expect(missingTagIds).toEqual([tag.id]);
    expect(todo.tags).toHaveLength(0);
    expect(todo.title).toBe('Quarterly Business Review');
    expect(todo.subtasks).toHaveLength(1);
  });
});
