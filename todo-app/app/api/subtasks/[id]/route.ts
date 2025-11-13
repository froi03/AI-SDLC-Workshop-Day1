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

function toErrorResponse(error: unknown, fallback: string) {
  const message = (error as Error)?.message ?? fallback;
  if (message === 'Subtask not found') {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (message === 'Subtask title is required' || message === 'Subtask title must be at most 200 characters') {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  const title = parseTitle((body as Record<string, unknown>).title);
  if (!title) {
    return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
  }

  try {
    const { subtask, progress } = subtaskDB.updateTitle(id, session.userId, title);
    return NextResponse.json({ subtask, progress });
  } catch (error) {
    return toErrorResponse(error, 'Failed to update subtask');
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id == null) {
    return NextResponse.json({ error: 'Invalid subtask id' }, { status: 400 });
  }

  try {
    const progress = subtaskDB.delete(id, session.userId);
    return NextResponse.json({ progress, subtaskId: id });
  } catch (error) {
    return toErrorResponse(error, 'Failed to delete subtask');
  }
}
