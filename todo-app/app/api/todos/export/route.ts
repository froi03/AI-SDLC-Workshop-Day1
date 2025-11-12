import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

function toSingaporeIso(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const dateTime = DateTime.fromISO(value).setZone('Asia/Singapore');
  if (!dateTime.isValid) {
    return null;
  }

  const iso = dateTime.toISO();
  return iso ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const todos = todoDB.listWithRelations(session.userId);
  const tags = tagDB.listByUser(session.userId);

  const exportedTodos = todos.map((todo) => ({
    id: todo.id,
    title: todo.title,
    description: todo.description,
    priority: todo.priority,
    is_completed: todo.isCompleted,
    due_date: toSingaporeIso(todo.dueDate),
    is_recurring: todo.isRecurring,
    recurrence_pattern: todo.recurrencePattern,
    reminder_minutes: todo.reminderMinutes,
    created_at: toSingaporeIso(todo.createdAt),
    updated_at: toSingaporeIso(todo.updatedAt),
    subtasks: todo.subtasks.map((subtask) => ({
      id: subtask.id,
      title: subtask.title,
      position: subtask.position,
      is_completed: subtask.isCompleted,
      created_at: toSingaporeIso(subtask.createdAt),
      updated_at: toSingaporeIso(subtask.updatedAt)
    })),
    tagIds: todo.tagIds
  }));

  const exportedTags = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    created_at: toSingaporeIso(tag.createdAt),
    updated_at: toSingaporeIso(tag.updatedAt)
  }));

  const exportedAt = getSingaporeNow().setZone('Asia/Singapore');
  const filename = `todos-${exportedAt.toFormat('yyyy-LL-dd')}.json`;

  const payload = {
    version: '1.0.0',
    exported_at: exportedAt.toISO(),
    todos: exportedTodos,
    tags: exportedTags
  };

  const response = NextResponse.json(payload);
  response.headers.set('Content-Type', 'application/json');
  response.headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  return response;
}
