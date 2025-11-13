import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const candidates = todoDB.listReminderCandidates(session.userId);
  if (candidates.length === 0) {
    return NextResponse.json({ todos: [] });
  }

  const now = getSingaporeNow();
  const sentAtIso = now.toUTC().toISO();
  if (!sentAtIso) {
    return NextResponse.json({ error: 'Failed to derive timestamp' }, { status: 500 });
  }

  const dueReminders = candidates.filter((todo) => {
    if (!todo.dueDate || todo.reminderMinutes == null) {
      return false;
    }

    const due = DateTime.fromISO(todo.dueDate).setZone('Asia/Singapore');
    if (!due.isValid) {
      return false;
    }

    if (now >= due) {
      return false;
    }

    const reminderThreshold = due.minus({ minutes: todo.reminderMinutes });
    if (!reminderThreshold.isValid) {
      return false;
    }

    if (now < reminderThreshold) {
      return false;
    }

    if (todo.lastNotificationSent) {
      const lastSent = DateTime.fromISO(todo.lastNotificationSent).setZone('Asia/Singapore');
      if (lastSent.isValid && lastSent >= reminderThreshold) {
        return false;
      }
    }

    return true;
  });

  if (dueReminders.length > 0) {
    todoDB.markNotificationsSent(
      session.userId,
      dueReminders.map((todo) => todo.id),
      sentAtIso
    );
  }

  return NextResponse.json({
    todos: dueReminders.map((todo) => ({
      id: todo.id,
      title: todo.title,
      dueDate: todo.dueDate,
      reminderMinutes: todo.reminderMinutes,
      priority: todo.priority
    }))
  });
}
