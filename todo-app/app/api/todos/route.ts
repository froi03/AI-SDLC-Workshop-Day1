import { NextRequest, NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { getSession } from '@/lib/auth';
import { db, tagDB, todoDB, type Priority, type RecurrencePattern, type Todo } from '@/lib/db';
import { getSingaporeNow, isFutureSingaporeDate, parseSingaporeDate } from '@/lib/timezone';

const REMINDER_OPTIONS = new Set([15, 30, 60, 120, 1440, 2880, 10080]);

function validatePriority(priority: unknown): priority is Priority {
  return priority === 'high' || priority === 'medium' || priority === 'low';
}

function validateRecurrence(pattern: unknown): pattern is RecurrencePattern {
  return pattern === 'daily' || pattern === 'weekly' || pattern === 'monthly' || pattern === 'yearly';
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const monthParam = request.nextUrl.searchParams.get('month');
  let todos: Todo[];

  if (monthParam) {
    const parsedMonth = DateTime.fromFormat(monthParam, 'yyyy-LL', { zone: 'Asia/Singapore' }).startOf('month');
    if (!parsedMonth.isValid) {
      return NextResponse.json({ error: 'Invalid month parameter' }, { status: 400 });
    }

    const rangeStart = parsedMonth.toUTC().toISO();
    const rangeEnd = parsedMonth.plus({ months: 1 }).toUTC().toISO();
    if (!rangeStart || !rangeEnd) {
      return NextResponse.json({ error: 'Failed to derive month boundaries' }, { status: 400 });
    }

    todos = todoDB.listByDueDateRange(session.userId, rangeStart, rangeEnd);
  } else {
    todos = todoDB.listByUser(session.userId);
  }

  return NextResponse.json({ todos });
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

  let { title, description, priority, dueDate, isRecurring, recurrencePattern, reminderMinutes, tagIds } = body as {
    title?: unknown;
    description?: unknown;
    priority?: unknown;
    dueDate?: unknown;
    isRecurring?: unknown;
    recurrencePattern?: unknown;
    reminderMinutes?: unknown;
    tagIds?: unknown;
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

  let finalTagIds: number[] = [];
  if (tagIds != null) {
    if (!Array.isArray(tagIds)) {
      return NextResponse.json({ error: 'tagIds must be an array of numbers' }, { status: 400 });
    }
    const parsed = tagIds
      .map((value) => (typeof value === 'number' ? value : Number.parseInt(String(value), 10)))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (parsed.length !== tagIds.length) {
      return NextResponse.json({ error: 'tagIds must be an array of numbers' }, { status: 400 });
    }
    finalTagIds = Array.from(new Set(parsed));
    try {
      tagDB.ensureOwned(session.userId, finalTagIds);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 404 });
    }
  }

  const result = db.transaction(() => {
    const created = todoDB.create({
      userId: session.userId,
      title: title as string,
      description: finalDescription,
      priority: finalPriority,
      dueDate: finalDueDate,
      isRecurring: finalIsRecurring,
      recurrencePattern: finalRecurrencePattern,
      reminderMinutes: finalReminder
    });

    if (finalTagIds.length > 0) {
      const tags = tagDB.attachMany(created.id, finalTagIds, session.userId);
      return { todo: { ...created, tags } as Todo };
    }

    return { todo: created };
  })();

  return NextResponse.json(result, { status: 201 });
}
