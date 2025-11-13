import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

function validateName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 50) {
    return null;
  }
  return trimmed;
}

function validateColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return HEX_REGEX.test(trimmed) ? trimmed.toUpperCase() : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const tags = tagDB.listWithCounts(session.userId);
  return NextResponse.json({ tags });
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

  const name = validateName((body as Record<string, unknown>).name);
  if (!name) {
    return NextResponse.json({ error: 'Tag name is required and must be 1-50 characters' }, { status: 400 });
  }

  const color = validateColor((body as Record<string, unknown>).color);
  if (!color) {
    return NextResponse.json({ error: 'Color must be a hex value like #3366FF' }, { status: 400 });
  }

  const descriptionValue = (body as Record<string, unknown>).description;
  let description: string | null = null;
  if (descriptionValue != null) {
    if (typeof descriptionValue !== 'string') {
      return NextResponse.json({ error: 'Description must be a string' }, { status: 400 });
    }
    const trimmedDescription = descriptionValue.trim();
    if (trimmedDescription.length > 200) {
      return NextResponse.json({ error: 'Description must be 200 characters or fewer' }, { status: 400 });
    }
    description = trimmedDescription.length === 0 ? null : trimmedDescription;
  }

  try {
    const tag = tagDB.create(session.userId, { name, color, description });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    const code = (error as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || message.toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'Tag name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: message || 'Failed to create tag' }, { status: 500 });
  }
}
