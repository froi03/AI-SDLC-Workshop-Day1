import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';

type UseTemplateBody = {
  dueDate?: unknown;
  dueOffsetDays?: unknown;
};

function mapTemplateError(error: unknown, fallback = 400) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const lower = message.toLowerCase();
  if (lower.includes('not authenticated')) {
    return NextResponse.json({ error: message }, { status: 401 });
  }
  if (lower.includes('not found')) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return NextResponse.json({ error: message }, { status: fallback });
}

export async function POST(
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

  const body = (await request.json().catch(() => null)) as UseTemplateBody | null;
  const options: { dueDate?: string | null; dueOffsetDays?: number | null } = {};

  if (body && typeof body === 'object') {
    if ('dueDate' in body) {
      if (body.dueDate == null) {
        options.dueDate = null;
      } else if (typeof body.dueDate === 'string') {
        options.dueDate = body.dueDate;
      } else {
        return NextResponse.json({ error: 'dueDate must be an ISO string or null' }, { status: 400 });
      }
    }

    if ('dueOffsetDays' in body) {
      if (body.dueOffsetDays == null) {
        options.dueOffsetDays = null;
      } else {
        const numeric =
          typeof body.dueOffsetDays === 'number'
            ? body.dueOffsetDays
            : Number.parseInt(String(body.dueOffsetDays), 10);
        if (!Number.isInteger(numeric) || numeric < 0) {
          return NextResponse.json({ error: 'dueOffsetDays must be a non-negative integer' }, { status: 400 });
        }
        options.dueOffsetDays = numeric;
      }
    }
  }

  try {
    const result = templateDB.use(templateId, session.userId, options);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return mapTemplateError(error);
  }
}
