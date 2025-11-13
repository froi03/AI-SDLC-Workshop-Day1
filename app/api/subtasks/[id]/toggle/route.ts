import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB } from '@/lib/db';

function parseId(rawId: string): number | null {
  const value = Number.parseInt(rawId, 10);
  return Number.isNaN(value) ? null : value;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }
  return null;
}

function toErrorResponse(error: unknown, fallback: string) {
  const message = (error as Error)?.message ?? fallback;
  if (message === 'Subtask not found') {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id == null) {
    return NextResponse.json({ error: 'Invalid subtask id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const isCompleted = parseBoolean((body as Record<string, unknown>).isCompleted);
  if (isCompleted === null) {
    return NextResponse.json({ error: 'isCompleted must be a boolean' }, { status: 400 });
  }

  try {
    const { subtask, progress } = subtaskDB.toggleCompletion(id, session.userId, isCompleted);
    return NextResponse.json({ subtask, progress });
  } catch (error) {
    return toErrorResponse(error, 'Failed to toggle subtask');
  }
}
