import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, subtaskDB, tagDB, todoDB, todoTagDB, type Priority, type RecurrencePattern } from '@/lib/db';
import { getSingaporeNow, parseSingaporeDate } from '@/lib/timezone';

const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5 MB
const REMINDER_OPTIONS = new Set([15, 30, 60, 120, 1440, 2880, 10080]);

function singaporeUtcIso(): string {
  const iso = getSingaporeNow().toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to derive Singapore timestamp');
  }
  return iso;
}

function parseOptionalSingaporeDate(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return parseSingaporeDate(value);
  } catch {
    return null;
  }
}

function normalizePriorityValue(priority: unknown): Priority {
  return priority === 'high' || priority === 'medium' || priority === 'low' ? priority : 'medium';
}

function normalizeRecurrenceValue(pattern: unknown): RecurrencePattern | null {
  return pattern === 'daily' || pattern === 'weekly' || pattern === 'monthly' || pattern === 'yearly' ? pattern : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader && Number.parseInt(contentLengthHeader, 10) > MAX_IMPORT_SIZE) {
    return NextResponse.json({ error: 'Import file too large' }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_IMPORT_SIZE) {
    return NextResponse.json({ error: 'Import file too large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid import structure' }, { status: 400 });
  }

  const { todos, tags } = payload as { todos?: unknown; tags?: unknown };
  if (!Array.isArray(todos) || !Array.isArray(tags)) {
    return NextResponse.json({ error: 'Import payload must include todos and tags arrays' }, { status: 400 });
  }

  const tagIdMap = new Map<number, number>();
  let importedTodos = 0;
  let importedSubtasks = 0;
  let importedTags = 0;
  let reusedTags = 0;

  const runImport = db.transaction(() => {
    for (const rawTag of tags as unknown[]) {
      if (!rawTag || typeof rawTag !== 'object') {
        continue;
      }

      const source = rawTag as Record<string, unknown>;
      const sourceId = typeof source.id === 'number' ? source.id : null;
      const name = typeof source.name === 'string' ? source.name.trim() : '';
      if (!name) {
        continue;
      }

      const colorRaw = typeof source.color === 'string' ? source.color.trim() : '';
      const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw.toUpperCase() : '#3B82F6';

      const existing = tagDB.getByName(session.userId, name);
      if (existing) {
        reusedTags += 1;
        if (sourceId != null) {
          tagIdMap.set(sourceId, existing.id);
        }
        continue;
      }

      const createdAt = parseOptionalSingaporeDate(source.created_at) ?? singaporeUtcIso();
      const updatedAt = parseOptionalSingaporeDate(source.updated_at) ?? createdAt;

      const newTag = tagDB.createWithMetadata({
        userId: session.userId,
        name,
        color,
        createdAt,
        updatedAt
      });
      importedTags += 1;
      if (sourceId != null) {
        tagIdMap.set(sourceId, newTag.id);
      }
    }

    for (const rawTodo of todos as unknown[]) {
      if (!rawTodo || typeof rawTodo !== 'object') {
        continue;
      }

      const source = rawTodo as Record<string, unknown>;
      const title = typeof source.title === 'string' ? source.title.trim() : '';
      if (!title) {
        continue;
      }

      const description = typeof source.description === 'string' ? source.description.trim() : '';
      const priority = normalizePriorityValue(source.priority);
      const dueDate = parseOptionalSingaporeDate(source.due_date ?? source.dueDate);
      const isCompleted = Boolean(source.is_completed ?? source.isCompleted);
      const completedAt = isCompleted ? parseOptionalSingaporeDate(source.completed_at ?? source.completedAt) ?? singaporeUtcIso() : null;
      const isRecurring = Boolean(source.is_recurring ?? source.isRecurring);
      const recurrencePattern = isRecurring ? normalizeRecurrenceValue(source.recurrence_pattern ?? source.recurrencePattern) : null;
      const reminderMinutes = typeof source.reminder_minutes === 'number' && REMINDER_OPTIONS.has(source.reminder_minutes)
        ? source.reminder_minutes
        : null;

      const todoCreatedAt = parseOptionalSingaporeDate(source.created_at ?? source.createdAt) ?? singaporeUtcIso();
      const todoUpdatedAt = parseOptionalSingaporeDate(source.updated_at ?? source.updatedAt) ?? todoCreatedAt;

      const newTodo = todoDB.createWithMetadata({
        userId: session.userId,
        title,
        description,
        priority,
        dueDate,
        isCompleted,
        completedAt,
        isRecurring,
        recurrencePattern,
        reminderMinutes,
        createdAt: todoCreatedAt,
        updatedAt: todoUpdatedAt
      });
      importedTodos += 1;

      const tagReferences = Array.isArray(source.tagIds)
        ? (source.tagIds as unknown[])
        : Array.isArray((source as Record<string, unknown>).tag_ids)
          ? ((source as Record<string, unknown>).tag_ids as unknown[])
          : [];

      const uniqueTagIds = new Set<number>();
      for (const tagReference of tagReferences) {
        if (typeof tagReference !== 'number') {
          continue;
        }
        const mapped = tagIdMap.get(tagReference);
        if (mapped) {
          uniqueTagIds.add(mapped);
        }
      }
      for (const tagId of uniqueTagIds) {
        todoTagDB.attach(newTodo.id, tagId);
      }

      const subtasks = Array.isArray(source.subtasks) ? (source.subtasks as unknown[]) : [];
      subtasks.forEach((rawSubtask, index) => {
        if (!rawSubtask || typeof rawSubtask !== 'object') {
          return;
        }
        const subtask = rawSubtask as Record<string, unknown>;
        const title = typeof subtask.title === 'string' ? subtask.title.trim() : '';
        if (!title) {
          return;
        }
        const position = typeof subtask.position === 'number' ? subtask.position : index;
        const isCompleted = Boolean(subtask.is_completed ?? subtask.isCompleted);
        const subtaskCreatedAt = parseOptionalSingaporeDate(subtask.created_at ?? subtask.createdAt) ?? todoCreatedAt;
        const subtaskUpdatedAt = parseOptionalSingaporeDate(subtask.updated_at ?? subtask.updatedAt) ?? subtaskCreatedAt;

        subtaskDB.createWithMetadata({
          todoId: newTodo.id,
          title,
          position,
          isCompleted,
          createdAt: subtaskCreatedAt,
          updatedAt: subtaskUpdatedAt
        });
        importedSubtasks += 1;
      });
    }
  });

  try {
    runImport();
  } catch (error) {
    console.error('Failed to import todos', error);
    return NextResponse.json({ error: 'Failed to import todos' }, { status: 400 });
  }

  return NextResponse.json({ importedTodos, importedSubtasks, importedTags, reusedTags });
}
