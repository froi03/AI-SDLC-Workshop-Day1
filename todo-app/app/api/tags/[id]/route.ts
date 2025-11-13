import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

function parseId(rawId: string): number | null {
  const value = Number.parseInt(rawId, 10);
  return Number.isNaN(value) ? null : value;
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id == null) {
    return NextResponse.json({ error: 'Invalid tag id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: { name?: string; color?: string; description?: string | null } = {};
  let hasUpdates = false;

  if ('name' in body) {
    if (typeof body.name !== 'string') {
      return NextResponse.json({ error: 'Tag name must be a string' }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0 || trimmed.length > 50) {
      return NextResponse.json({ error: 'Tag name must be 1-50 characters' }, { status: 400 });
    }
    updates.name = trimmed;
    hasUpdates = true;
  }

  if ('color' in body) {
    if (typeof body.color !== 'string') {
      return NextResponse.json({ error: 'Color must be a hex string' }, { status: 400 });
    }
    const trimmed = body.color.trim();
    if (!HEX_REGEX.test(trimmed)) {
      return NextResponse.json({ error: 'Color must be a hex value like #3366FF' }, { status: 400 });
    }
    updates.color = trimmed.toUpperCase();
    hasUpdates = true;
  }

  if ('description' in body) {
    if (body.description === null) {
      updates.description = null;
      hasUpdates = true;
    } else if (typeof body.description === 'string') {
      const trimmed = body.description.trim();
      if (trimmed.length === 0) {
        updates.description = null;
      } else if (trimmed.length > 200) {
        return NextResponse.json({ error: 'Description must be 1-200 characters when provided' }, { status: 400 });
      } else {
        updates.description = trimmed;
      }
      hasUpdates = true;
    } else {
      return NextResponse.json({ error: 'Description must be a string or null' }, { status: 400 });
    }
  }

  if (!hasUpdates) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  try {
    const tag = tagDB.update(id, session.userId, updates);
    return NextResponse.json({ tag });
  } catch (error) {
    const message = (error as Error).message;
    const code = (error as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || message.toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'Tag name already exists' }, { status: 409 });
    }
    if (message === 'Tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message || 'Failed to update tag' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id == null) {
    return NextResponse.json({ error: 'Invalid tag id' }, { status: 400 });
  }

  try {
    tagDB.delete(id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'Tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message || 'Failed to delete tag' }, { status: 500 });
  }
}
