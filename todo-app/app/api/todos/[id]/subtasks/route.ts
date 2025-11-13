import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB } from '@/lib/db';

function parseId(rawId: string): number | null {
  const value = Number.parseInt(rawId, 10);
  return Number.isNaN(value) ? null : value;
}

function parseTitle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parsePosition(value: unknown): number | undefined | null {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return null;
    }
    if (value < 0) {
      return null;
    }
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  }
  return null;
}

function toErrorResponse(error: unknown, fallback: string) {
  const message = (error as Error)?.message ?? fallback;
  if (message === 'Todo not found' || message === 'Subtask not found') {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (message === 'Subtask title is required' || message === 'Subtask title must be at most 200 characters') {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const todoId = parseId(rawId);
  if (todoId == null) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  try {
    const { subtasks, progress } = subtaskDB.listByTodo(todoId, session.userId);
    return NextResponse.json({ subtasks, progress, todoId });
  } catch (error) {
    return toErrorResponse(error, 'Failed to load subtasks');
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const todoId = parseId(rawId);
  if (todoId == null) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const title = parseTitle((body as Record<string, unknown>).title);
  if (!title) {
    return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
  }

  const positionResult = parsePosition((body as Record<string, unknown>).position);
  if (positionResult === null) {
    return NextResponse.json({ error: 'position must be a non-negative integer' }, { status: 400 });
  }

  try {
    const { subtask, progress } = subtaskDB.create(todoId, session.userId, {
      title,
      position: positionResult
    });
    return NextResponse.json({ subtask, progress, todoId });
  } catch (error) {
    return toErrorResponse(error, 'Failed to create subtask');
  }
}
