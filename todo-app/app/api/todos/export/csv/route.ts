import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

function toSingaporeIso(value: string | null): string {
  if (!value) {
    return '';
  }

  const parsed = DateTime.fromISO(value).setZone('Asia/Singapore');
  if (!parsed.isValid) {
    return '';
  }

  return parsed.toISO() ?? '';
}

function escapeCsvValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  const stringValue = String(value);
  if (stringValue.length === 0) {
    return '';
  }

  const needsWrapping = /[",\n\r]/.test(stringValue);
  const sanitized = stringValue.replace(/"/g, '""');
  return needsWrapping ? `"${sanitized}"` : sanitized;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const todos = todoDB.listWithRelations(session.userId);
  const tags = tagDB.listByUser(session.userId);
  const tagMap = new Map(tags.map((tag) => [tag.id, tag]));

  const header = [
    'id',
    'title',
    'description',
    'priority',
    'is_completed',
    'due_date',
    'is_recurring',
    'recurrence_pattern',
    'reminder_minutes',
    'created_at',
    'updated_at',
    'tag_names',
    'subtask_titles'
  ];

  const rows = todos.map((todo) => {
    const tagNames = todo.tagIds
      .map((id) => tagMap.get(id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(';');

    const subtaskTitles = todo.subtasks.map((subtask) => subtask.title).join(';');

    const values: Array<string> = [
      escapeCsvValue(todo.id),
      escapeCsvValue(todo.title),
      escapeCsvValue(todo.description),
      escapeCsvValue(todo.priority),
      escapeCsvValue(todo.isCompleted),
      escapeCsvValue(toSingaporeIso(todo.dueDate)),
      escapeCsvValue(todo.isRecurring),
      escapeCsvValue(todo.recurrencePattern ?? ''),
      escapeCsvValue(todo.reminderMinutes ?? ''),
      escapeCsvValue(toSingaporeIso(todo.createdAt)),
      escapeCsvValue(toSingaporeIso(todo.updatedAt)),
      escapeCsvValue(tagNames),
      escapeCsvValue(subtaskTitles)
    ];

    return values.join(',');
  });

  const csvContent = [header.join(','), ...rows].join('\n');

  const exportedAt = getSingaporeNow().setZone('Asia/Singapore');
  const filename = `todos-${exportedAt.toFormat('yyyy-LL-dd')}.csv`;

  const response = new NextResponse(csvContent);
  response.headers.set('Content-Type', 'text/csv; charset=utf-8');
  response.headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  return response;
}
