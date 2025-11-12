import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { getSession } from '@/lib/auth';
import { todoDB, Priority, RecurrencePattern } from '@/lib/db';
import { isFutureSingaporeDateTime } from '@/lib/timezone';

const createTodoSchemaBase = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title must not exceed 200 characters'),
  description: z.string().trim().max(2000).optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.null()).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  recurrencePattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  reminderMinutes: z.number().int().positive().nullable().optional()
});

type CreateTodoInput = z.infer<typeof createTodoSchemaBase>;

const createTodoSchema = createTodoSchemaBase.superRefine((data: CreateTodoInput, ctx: z.RefinementCtx) => {
    if (data.dueDate) {
      const dueIso = data.dueDate;
      const isFuture = isFutureSingaporeDateTime(dueIso);
      if (!isFuture) {
        ctx.addIssue({
          path: ['dueDate'],
          code: z.ZodIssueCode.custom,
          message: 'Due date must be at least 1 minute in the future (Singapore time)'
        });
      }
    }

    if (data.reminderMinutes != null && !data.dueDate) {
      ctx.addIssue({
        path: ['reminderMinutes'],
        code: z.ZodIssueCode.custom,
        message: 'Reminder requires a due date'
      });
    }

    if (!data.recurrencePattern && data.recurrencePattern !== null) {
      ctx.addIssue({
        path: ['recurrencePattern'],
        code: z.ZodIssueCode.custom,
        message: 'Invalid recurrence pattern'
      });
    }
  });

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const todos = todoDB.listByUser(session.userId);
  return NextResponse.json({ todos });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let payload: z.infer<typeof createTodoSchema>;
  try {
    const json = await request.json();
    payload = createTodoSchema.parse(json);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? 'Validation failed';
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const title = payload.title.trim();
  const description = payload.description?.trim() ?? '';
  const dueDate = payload.dueDate ?? null;
  const priority = (payload.priority ?? 'medium') as Priority;
  const recurrencePattern = (payload.recurrencePattern ?? null) as RecurrencePattern | null;
  const reminderMinutes = payload.reminderMinutes ?? null;

  try {
    const created = todoDB.create(session.userId, {
      title,
      description,
      dueDate,
      priority,
      recurrencePattern,
      reminderMinutes
    });

    return NextResponse.json({ todo: created }, { status: 201 });
  } catch (error) {
    console.error('Failed to create todo', error);
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 500 });
  }
}
