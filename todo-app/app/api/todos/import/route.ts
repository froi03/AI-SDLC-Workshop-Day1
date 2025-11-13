import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB, type TodosExportPayload } from '@/lib/db';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Unable to read request body' }, { status: 400 });
  }

  const bodySize = Buffer.byteLength(rawBody, 'utf8');
  if (bodySize > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: 'Import file exceeds 5MB limit' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid import payload' }, { status: 400 });
  }

  const { version, generatedAt, todos, subtasks, tags, todoTags } = payload as Record<string, unknown>;

  if (typeof version !== 'string' || version.trim() === '') {
    return NextResponse.json({ error: 'Export version is required' }, { status: 400 });
  }

  if (typeof generatedAt !== 'string' || generatedAt.trim() === '') {
    return NextResponse.json({ error: 'generatedAt must be an ISO string' }, { status: 400 });
  }

  if (!Array.isArray(todos) || !Array.isArray(subtasks) || !Array.isArray(tags) || !Array.isArray(todoTags)) {
    return NextResponse.json({ error: 'Export payload is missing required collections' }, { status: 400 });
  }

  try {
    const result = todoDB.importData(session.userId, payload as TodosExportPayload);
    return NextResponse.json(
      {
        importedTodosCount: result.createdTodoIds.length,
        importedSubtasksCount: result.createdSubtaskIds.length,
        importedTagsCount: result.createdTagIds.length
      },
      { status: 200 }
    );
  } catch (error) {
    const message = (error as Error).message ?? 'Failed to import data';
    const status = message === 'Unsupported export version' ? 400 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
