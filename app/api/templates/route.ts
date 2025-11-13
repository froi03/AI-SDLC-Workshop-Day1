import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB, type Priority, type RecurrencePattern, type TemplateSubtaskDefinition } from '@/lib/db';

const REMINDER_OPTIONS = new Set([15, 30, 60, 120, 1440, 2880, 10080]);

type CreateTemplateBody = {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  todoTitle?: unknown;
  todoDescription?: unknown;
  priority?: unknown;
  recurrencePattern?: unknown;
  reminderMinutes?: unknown;
  dueOffsetDays?: unknown;
  tagIds?: unknown;
  subtasks?: unknown;
  estimatedDurationMinutes?: unknown;
};

function isPriority(value: unknown): value is Priority {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isRecurrence(value: unknown): value is RecurrencePattern {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly';
}

function parseSubtasks(value: unknown): TemplateSubtaskDefinition[] | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('subtasks must be an array');
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return { title: '', position: 0 } as TemplateSubtaskDefinition;
    }

    const typed = entry as { title?: unknown; position?: unknown };
    return {
      title: typeof typed.title === 'string' ? typed.title : '',
      position:
        typeof typed.position === 'number'
          ? typed.position
          : Number.parseInt(String(typed.position ?? 0), 10)
    } as TemplateSubtaskDefinition;
  });
}

function parseTagIds(value: unknown): number[] | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('tagIds must be an array of numbers');
  }

  const parsed = value.map((entry) => {
    if (typeof entry === 'number') {
      return entry;
    }
    const numeric = Number.parseInt(String(entry), 10);
    return Number.isInteger(numeric) ? numeric : NaN;
  });

  if (parsed.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error('tagIds must be positive integers');
  }

  return Array.from(new Set(parsed));
}

function mapTemplateError(error: unknown, fallback = 400) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const lower = message.toLowerCase();
  if (lower.includes('already exists')) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (lower.includes('not found')) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return NextResponse.json({ error: message }, { status: fallback });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const templates = templateDB.list(session.userId);
  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateTemplateBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const {
    name,
    description,
    category,
    todoTitle,
    todoDescription,
    priority,
    recurrencePattern,
    reminderMinutes,
    dueOffsetDays,
    tagIds,
    subtasks,
    estimatedDurationMinutes
  } = body;

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Template name is required' }, { status: 400 });
  }

  if (typeof todoTitle !== 'string' || !todoTitle.trim()) {
    return NextResponse.json({ error: 'Todo title is required' }, { status: 400 });
  }

  if (!isPriority(priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
  }

  let finalRecurrence: RecurrencePattern | null = null;
  if (recurrencePattern != null) {
    if (!isRecurrence(recurrencePattern)) {
      return NextResponse.json({ error: 'Invalid recurrence pattern' }, { status: 400 });
    }
    finalRecurrence = recurrencePattern;
  }

  let finalReminder: number | null = null;
  if (reminderMinutes != null) {
    if (typeof reminderMinutes !== 'number' || !REMINDER_OPTIONS.has(reminderMinutes)) {
      return NextResponse.json({ error: 'Invalid reminder option' }, { status: 400 });
    }
    finalReminder = reminderMinutes;
  }

  let finalDueOffset = 0;
  if (dueOffsetDays != null) {
    const numeric = typeof dueOffsetDays === 'number' ? dueOffsetDays : Number.parseInt(String(dueOffsetDays), 10);
    if (!Number.isInteger(numeric) || numeric < 0) {
      return NextResponse.json({ error: 'dueOffsetDays must be a non-negative integer' }, { status: 400 });
    }
    finalDueOffset = numeric;
  }

  let finalTagIds: number[] | undefined;
  try {
    finalTagIds = parseTagIds(tagIds);
  } catch (error) {
    return mapTemplateError(error);
  }

  let finalSubtasks: TemplateSubtaskDefinition[] | undefined;
  try {
    finalSubtasks = parseSubtasks(subtasks);
  } catch (error) {
    return mapTemplateError(error);
  }

  if (estimatedDurationMinutes != null) {
    const numeric =
      typeof estimatedDurationMinutes === 'number'
        ? estimatedDurationMinutes
        : Number.parseInt(String(estimatedDurationMinutes), 10);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      return NextResponse.json({ error: 'estimatedDurationMinutes must be a positive integer' }, { status: 400 });
    }
  }

  if (description != null && typeof description !== 'string') {
    return NextResponse.json({ error: 'Description must be a string' }, { status: 400 });
  }

  if (category != null && typeof category !== 'string') {
    return NextResponse.json({ error: 'Category must be a string' }, { status: 400 });
  }

  if (todoDescription != null && typeof todoDescription !== 'string') {
    return NextResponse.json({ error: 'Todo description must be a string' }, { status: 400 });
  }

  try {
    const template = templateDB.create(session.userId, {
      name,
      description: description == null ? null : String(description),
      category: category == null ? null : String(category),
      todoTitle,
      todoDescription: todoDescription == null ? '' : String(todoDescription),
      priority,
      recurrencePattern: finalRecurrence,
      reminderMinutes: finalReminder,
      dueOffsetDays: finalDueOffset,
      tagIds: finalTagIds,
      subtasks: finalSubtasks,
      estimatedDurationMinutes:
        estimatedDurationMinutes == null
          ? null
          : Number.parseInt(String(estimatedDurationMinutes), 10)
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return mapTemplateError(error);
  }
}
