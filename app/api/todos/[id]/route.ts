import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, tagDB, todoDB, type Priority, type RecurrencePattern, type Todo } from '@/lib/db';
import { getSingaporeNow, isFutureSingaporeDate, parseSingaporeDate } from '@/lib/timezone';
import { getNextRecurrenceDueDate } from '@/lib/recurrence';

const REMINDER_OPTIONS = new Set([15, 30, 60, 120, 1440, 2880, 10080]);

function parseId(rawId: string): number | null {
  const id = Number.parseInt(rawId, 10);
  return Number.isNaN(id) ? null : id;
}

function validatePriority(priority: unknown): priority is Priority {
  return priority === 'high' || priority === 'medium' || priority === 'low';
}

function validateRecurrence(pattern: unknown): pattern is RecurrencePattern {
  return pattern === 'daily' || pattern === 'weekly' || pattern === 'monthly' || pattern === 'yearly';
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await context.params;
  const id = parseId(idParam);
  if (id == null) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const todo = todoDB.getById(id, session.userId);
  if (!todo) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  return NextResponse.json({ todo });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await context.params;
  const id = parseId(idParam);
  if (id == null) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const existing = todoDB.getById(id, session.userId);
  if (!existing) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: {
    title?: string;
    description?: string;
    priority?: Priority;
    dueDate?: string | null;
    isCompleted?: boolean;
    isRecurring?: boolean;
    recurrencePattern?: RecurrencePattern | null;
    reminderMinutes?: number | null;
    completedAt?: string | null;
    lastNotificationSent?: string | null;
  } = {};

  if ('title' in body) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (body.title.trim().length > 200) {
      return NextResponse.json({ error: 'Title must be 200 characters or fewer' }, { status: 400 });
    }
    updates.title = body.title.trim();
  }

  if ('description' in body) {
    if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'Description must be a string' }, { status: 400 });
    }
    const trimmed = body.description.trim();
    if (trimmed.length > 2000) {
      return NextResponse.json({ error: 'Description must be 2000 characters or fewer' }, { status: 400 });
    }
    updates.description = trimmed;
  }

  if ('priority' in body) {
    if (!validatePriority(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    updates.priority = body.priority;
  }

  if ('dueDate' in body) {
    if (body.dueDate === null) {
      updates.dueDate = null;
      updates.reminderMinutes = null;
      updates.isRecurring = false;
      updates.recurrencePattern = null;
      updates.lastNotificationSent = null;
    } else if (typeof body.dueDate === 'string') {
      try {
        const parsed = parseSingaporeDate(body.dueDate);
        if (!parsed || !isFutureSingaporeDate(parsed)) {
          return NextResponse.json({ error: 'Due date must be at least one minute in the future (Singapore timezone)' }, { status: 400 });
        }
        updates.dueDate = parsed;
        updates.lastNotificationSent = null;
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'dueDate must be an ISO string or null' }, { status: 400 });
    }
  }

  if ('isCompleted' in body) {
    if (typeof body.isCompleted !== 'boolean') {
      return NextResponse.json({ error: 'isCompleted must be boolean' }, { status: 400 });
    }
    updates.isCompleted = body.isCompleted;
  }

  if ('isRecurring' in body) {
    if (typeof body.isRecurring !== 'boolean') {
      return NextResponse.json({ error: 'isRecurring must be boolean' }, { status: 400 });
    }
    updates.isRecurring = body.isRecurring;
  }

  if ('recurrencePattern' in body) {
    if (body.recurrencePattern === null) {
      updates.recurrencePattern = null;
    } else if (!validateRecurrence(body.recurrencePattern)) {
      return NextResponse.json({ error: 'Invalid recurrence pattern' }, { status: 400 });
    } else {
      updates.recurrencePattern = body.recurrencePattern;
    }
  }

  if ('reminderMinutes' in body) {
    if (body.reminderMinutes === null) {
      updates.reminderMinutes = null;
      updates.lastNotificationSent = null;
    } else if (typeof body.reminderMinutes !== 'number' || !REMINDER_OPTIONS.has(body.reminderMinutes)) {
      return NextResponse.json({ error: 'Invalid reminder option' }, { status: 400 });
    } else {
      updates.reminderMinutes = body.reminderMinutes;
      updates.lastNotificationSent = null;
    }
  }

  const finalIsRecurring = updates.isRecurring ?? existing.isRecurring;
  const finalDueDate = updates.dueDate === undefined ? existing.dueDate : updates.dueDate;
  const finalRecurrence = updates.recurrencePattern ?? (finalIsRecurring ? existing.recurrencePattern : null);
  const finalReminder = updates.reminderMinutes === undefined ? existing.reminderMinutes : updates.reminderMinutes;

  if (finalIsRecurring) {
    if (!finalDueDate) {
      return NextResponse.json({ error: 'Recurring todos require a due date' }, { status: 400 });
    }
    if (!finalRecurrence) {
      return NextResponse.json({ error: 'Recurring todos must include a recurrence pattern' }, { status: 400 });
    }
  }

  if (finalReminder != null && !finalDueDate) {
    return NextResponse.json({ error: 'Reminder requires a due date' }, { status: 400 });
  }

  if (updates.isCompleted) {
    updates.completedAt = getSingaporeNow().toUTC().toISO();
  }
  if (updates.isCompleted === false) {
    updates.completedAt = null;
  }

  const isCompleting = updates.isCompleted === true && !existing.isCompleted;

  const applyUpdate = db.transaction(() => {
    const updatedTodo = todoDB.update(id, session.userId, updates);

    if (!isCompleting || !updatedTodo.isRecurring || !updatedTodo.recurrencePattern || !updatedTodo.dueDate) {
      return { updatedTodo, nextTodo: null as Todo | null };
    }

    const nextDueDate = getNextRecurrenceDueDate(updatedTodo.dueDate, updatedTodo.recurrencePattern);
    if (!nextDueDate) {
      return { updatedTodo, nextTodo: null as Todo | null };
    }

    const nextTodo = todoDB.create({
      userId: session.userId,
      title: updatedTodo.title,
      description: updatedTodo.description,
      priority: updatedTodo.priority,
      dueDate: nextDueDate,
      isRecurring: true,
      recurrencePattern: updatedTodo.recurrencePattern,
      reminderMinutes: updatedTodo.reminderMinutes
    });

    const tagIdsToCopy = updatedTodo.tags.map((tag) => tag.id);
    const tagsForNext = tagIdsToCopy.length > 0 ? tagDB.attachMany(nextTodo.id, tagIdsToCopy, session.userId) : [];

    return { updatedTodo, nextTodo: { ...nextTodo, tags: tagsForNext } };
  });

  const { updatedTodo: updated, nextTodo } = applyUpdate();
  return NextResponse.json({ todo: updated, nextTodo });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await context.params;
  const id = parseId(idParam);
  if (id == null) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const existing = todoDB.getById(id, session.userId);
  if (!existing) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  todoDB.delete(id, session.userId);
  return NextResponse.json({ success: true });
}
