import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  templateDB,
  type Priority,
  type RecurrencePattern,
  type TemplateInput,
  type TemplateSubtaskDefinition
} from '@/lib/db';

const REMINDER_OPTIONS = new Set([15, 30, 60, 120, 1440, 2880, 10080]);

type UpdateTemplateBody = Partial<{
  name: unknown;
  description: unknown;
  category: unknown;
  todoTitle: unknown;
  todoDescription: unknown;
  priority: unknown;
  recurrencePattern: unknown;
  reminderMinutes: unknown;
  dueOffsetDays: unknown;
  tagIds: unknown;
  subtasks: unknown;
  estimatedDurationMinutes: unknown;
}>;

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
  if (lower.includes('not found')) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (lower.includes('already exists')) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: fallback });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await context.params;
  const templateId = Number.parseInt(id, 10);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as UpdateTemplateBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updatePayload: Partial<TemplateInput> = {};

  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'Template name is required' }, { status: 400 });
    }
    updatePayload.name = body.name;
  }

  if ('description' in body) {
    if (body.description != null && typeof body.description !== 'string') {
      return NextResponse.json({ error: 'Description must be a string' }, { status: 400 });
    }
    updatePayload.description = body.description == null ? null : String(body.description);
  }

  if ('category' in body) {
    if (body.category != null && typeof body.category !== 'string') {
      return NextResponse.json({ error: 'Category must be a string' }, { status: 400 });
    }
    updatePayload.category = body.category == null ? null : String(body.category);
  }

  if ('todoTitle' in body) {
    if (typeof body.todoTitle !== 'string' || !body.todoTitle.trim()) {
      return NextResponse.json({ error: 'Todo title is required' }, { status: 400 });
    }
    updatePayload.todoTitle = body.todoTitle;
  }

  if ('todoDescription' in body) {
    if (body.todoDescription != null && typeof body.todoDescription !== 'string') {
      return NextResponse.json({ error: 'Todo description must be a string' }, { status: 400 });
    }
    updatePayload.todoDescription = body.todoDescription == null ? '' : String(body.todoDescription);
  }

  if ('priority' in body) {
    if (!isPriority(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    updatePayload.priority = body.priority;
  }

  if ('recurrencePattern' in body) {
    if (body.recurrencePattern == null) {
      updatePayload.recurrencePattern = null;
    } else if (!isRecurrence(body.recurrencePattern)) {
      return NextResponse.json({ error: 'Invalid recurrence pattern' }, { status: 400 });
    } else {
      updatePayload.recurrencePattern = body.recurrencePattern;
    }
  }

  if ('reminderMinutes' in body) {
    if (body.reminderMinutes == null) {
      updatePayload.reminderMinutes = null;
    } else if (
      typeof body.reminderMinutes !== 'number' ||
      !REMINDER_OPTIONS.has(body.reminderMinutes)
    ) {
      return NextResponse.json({ error: 'Invalid reminder option' }, { status: 400 });
    } else {
      updatePayload.reminderMinutes = body.reminderMinutes;
    }
  }

  if ('dueOffsetDays' in body) {
    if (body.dueOffsetDays == null) {
      updatePayload.dueOffsetDays = 0;
    } else {
      const numeric =
        typeof body.dueOffsetDays === 'number'
          ? body.dueOffsetDays
          : Number.parseInt(String(body.dueOffsetDays), 10);
      if (!Number.isInteger(numeric) || numeric < 0) {
        return NextResponse.json({ error: 'dueOffsetDays must be a non-negative integer' }, { status: 400 });
      }
      updatePayload.dueOffsetDays = numeric;
    }
  }

  if ('estimatedDurationMinutes' in body) {
    if (body.estimatedDurationMinutes == null) {
      updatePayload.estimatedDurationMinutes = null;
    } else {
      const numeric =
        typeof body.estimatedDurationMinutes === 'number'
          ? body.estimatedDurationMinutes
          : Number.parseInt(String(body.estimatedDurationMinutes), 10);
      if (!Number.isInteger(numeric) || numeric <= 0) {
        return NextResponse.json({ error: 'estimatedDurationMinutes must be a positive integer' }, { status: 400 });
      }
      updatePayload.estimatedDurationMinutes = numeric;
    }
  }

  if ('tagIds' in body) {
    try {
      updatePayload.tagIds = parseTagIds(body.tagIds) ?? [];
    } catch (error) {
      return mapTemplateError(error);
    }
  }

  if ('subtasks' in body) {
    try {
      updatePayload.subtasks = parseSubtasks(body.subtasks) ?? [];
    } catch (error) {
      return mapTemplateError(error);
    }
  }

  try {
    const template = templateDB.update(templateId, session.userId, updatePayload);
    return NextResponse.json({ template });
  } catch (error) {
    return mapTemplateError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await context.params;
  const templateId = Number.parseInt(id, 10);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
  }

  try {
    templateDB.delete(templateId, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return mapTemplateError(error, 404);
  }
}
