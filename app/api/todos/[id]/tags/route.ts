import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';

function parseId(rawId: string): number | null {
  const value = Number.parseInt(rawId, 10);
  return Number.isNaN(value) ? null : value;
}

function extractTagId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
  }
  return null;
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

  const tagId = extractTagId((body as Record<string, unknown>).tagId);
  if (tagId == null) {
    return NextResponse.json({ error: 'tagId must be a positive integer' }, { status: 400 });
  }

  try {
    const tags = tagDB.attachTag(todoId, tagId, session.userId);
    return NextResponse.json({ tags, todoId });
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'Todo not found' || message === 'Tag not found') {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message || 'Failed to attach tag' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  const tagId = extractTagId((body as Record<string, unknown>).tagId);
  if (tagId == null) {
    return NextResponse.json({ error: 'tagId must be a positive integer' }, { status: 400 });
  }

  try {
    const tags = tagDB.detachTag(todoId, tagId, session.userId);
    return NextResponse.json({ tags, todoId });
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'Todo not found' || message === 'Tag not found') {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message || 'Failed to detach tag' }, { status: 500 });
  }
}
