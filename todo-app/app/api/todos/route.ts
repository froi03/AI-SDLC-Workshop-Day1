import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB, type Priority, type RecurrencePattern } from '@/lib/db';
import { getSingaporeNow, isFutureSingaporeDate, parseSingaporeDate } from '@/lib/timezone';

const REMINDER_OPTIONS = new Set([15, 30, 60, 120, 1440, 2880, 10080]);

function validatePriority(priority: unknown): priority is Priority {
  return priority === 'high' || priority === 'medium' || priority === 'low';
}

function validateRecurrence(pattern: unknown): pattern is RecurrencePattern {
  return pattern === 'daily' || pattern === 'weekly' || pattern === 'monthly' || pattern === 'yearly';
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const todos = todoDB.listWithRelations(session.userId);
  const tags = tagDB.listByUser(session.userId);
  return NextResponse.json({ todos, tags, userId: session.userId });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  let { title, description, priority, dueDate, isRecurring, recurrencePattern, reminderMinutes } = body as {
    title?: unknown;
    description?: unknown;
    priority?: unknown;
    dueDate?: unknown;
    isRecurring?: unknown;
    recurrencePattern?: unknown;
    reminderMinutes?: unknown;
  };

  if (typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  title = title.trim();
  if ((title as string).length > 200) {
    return NextResponse.json({ error: 'Title must be 200 characters or fewer' }, { status: 400 });
  }

  if (description != null && typeof description !== 'string') {
    return NextResponse.json({ error: 'Description must be a string' }, { status: 400 });
  }

  const finalDescription = (description as string | undefined)?.trim() ?? '';
  if (finalDescription.length > 2000) {
    return NextResponse.json({ error: 'Description must be 2000 characters or fewer' }, { status: 400 });
  }

  if (priority != null && !validatePriority(priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
  }

  const finalPriority: Priority = (priority as Priority) ?? 'medium';

  let finalDueDate: string | null = null;
  if (dueDate != null) {
    if (typeof dueDate !== 'string') {
      return NextResponse.json({ error: 'dueDate must be an ISO string' }, { status: 400 });
    }

    try {
      finalDueDate = parseSingaporeDate(dueDate);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }

    if (!finalDueDate || !isFutureSingaporeDate(finalDueDate)) {
      return NextResponse.json({ error: 'Due date must be at least one minute in the future (Singapore timezone)' }, { status: 400 });
    }
  }

  if (typeof isRecurring !== 'undefined' && typeof isRecurring !== 'boolean') {
    return NextResponse.json({ error: 'isRecurring must be boolean' }, { status: 400 });
  }

  const finalIsRecurring = Boolean(isRecurring);

  if (finalIsRecurring) {
    if (!finalDueDate) {
      return NextResponse.json({ error: 'Recurring todos require a due date' }, { status: 400 });
    }
    if (!validateRecurrence(recurrencePattern)) {
      return NextResponse.json({ error: 'Invalid recurrence pattern' }, { status: 400 });
    }
  }

  const finalRecurrencePattern = finalIsRecurring ? (recurrencePattern as RecurrencePattern) : null;

  if (reminderMinutes != null) {
    if (typeof reminderMinutes !== 'number' || !REMINDER_OPTIONS.has(reminderMinutes)) {
      return NextResponse.json({ error: 'Invalid reminder option' }, { status: 400 });
    }

    if (!finalDueDate) {
      return NextResponse.json({ error: 'Reminder requires a due date' }, { status: 400 });
    }
  }

  const finalReminder = (reminderMinutes as number | null) ?? null;

  const todo = todoDB.create({
    userId: session.userId,
    title: title as string,
    description: finalDescription,
    priority: finalPriority,
    dueDate: finalDueDate,
    isRecurring: finalIsRecurring,
    recurrencePattern: finalRecurrencePattern,
    reminderMinutes: finalReminder
  });

  const tags = tagDB.listByUser(session.userId);
  return NextResponse.json({
    todo: { ...todo, subtasks: [], tagIds: [] },
    tags
  }, { status: 201 });
}
