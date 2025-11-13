'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import type { Holiday, Priority, Todo } from '@/lib/db';
import { buildCalendarMatrix, bucketTodosByDate, toSingaporeDateKey, SINGAPORE_ZONE } from '@/lib/calendar';
import { getSingaporeNow } from '@/lib/timezone';

const PRIORITY_BADGE_STYLES: Record<Priority, { background: string; border: string; text: string }> = {
  high: { background: '#ef4444', border: '#b91c1c', text: '#0f172a' },
  medium: { background: '#f59e0b', border: '#b45309', text: '#0f172a' },
  low: { background: '#3b82f6', border: '#1d4ed8', text: '#0f172a' }
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type FetchState = {
  loading: boolean;
  error: string | null;
};

function formatTodoTime(dueDate: string | null): string {
  if (!dueDate) {
    return '';
  }
  const dateTime = DateTime.fromISO(dueDate).setZone(SINGAPORE_ZONE, { keepLocalTime: false });
  if (!dateTime.isValid) {
    return '';
  }
  return dateTime.toFormat('HH:mm');
}

function describeDay(date: DateTime, todoCount: number, holidayNames: string[]): string {
  const parts = [date.toFormat('cccc, dd LLLL yyyy')];
  if (todoCount === 0) {
    parts.push('No todos');
  } else if (todoCount === 1) {
    parts.push('1 todo due');
  } else {
    parts.push(`${todoCount} todos due`);
  }
  if (holidayNames.length > 0) {
    parts.push(`Holidays: ${holidayNames.join(', ')}`);
  }
  return parts.join('. ');
}

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMonth = useMemo(() => {
    const monthParam = searchParams.get('month');
    if (monthParam) {
      const parsed = DateTime.fromFormat(monthParam, 'yyyy-LL', { zone: SINGAPORE_ZONE }).startOf('month');
      if (parsed.isValid) {
        return parsed;
      }
    }
    return getSingaporeNow().setZone(SINGAPORE_ZONE, { keepLocalTime: false }).startOf('month');
  }, [searchParams]);

  const [currentMonth, setCurrentMonth] = useState<DateTime>(initialMonth);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [calendarState, setCalendarState] = useState<FetchState>({ loading: true, error: null });
  const [selectedDate, setSelectedDate] = useState<DateTime | null>(null);
  const [updatingTodoIds, setUpdatingTodoIds] = useState<number[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const todayKey = useMemo(() => toSingaporeDateKey(getSingaporeNow()), []);

  const fetchMonthData = useCallback(async (targetMonth: DateTime) => {
    setCalendarState({ loading: true, error: null });
    const monthKey = targetMonth.toFormat('yyyy-LL');

    try {
      const [todosResponse, holidaysResponse] = await Promise.all([
        fetch(`/api/todos?month=${monthKey}`, { cache: 'no-store' }),
        fetch(`/api/holidays?month=${monthKey}`, { cache: 'no-store' })
      ]);

      if (!todosResponse.ok) {
        const payload = await todosResponse.json().catch(() => ({ error: 'Failed to load todos' }));
        throw new Error(payload.error ?? 'Failed to load todos');
      }

      if (!holidaysResponse.ok) {
        const payload = await holidaysResponse.json().catch(() => ({ error: 'Failed to load holidays' }));
        throw new Error(payload.error ?? 'Failed to load holidays');
      }

      const todoData = (await todosResponse.json()) as { todos?: Todo[] };
      const holidayData = (await holidaysResponse.json()) as { holidays?: Holiday[] };

      setTodos(todoData.todos ?? []);
      setHolidays(holidayData.holidays ?? []);
      setCalendarState({ loading: false, error: null });
    } catch (error) {
      setTodos([]);
      setHolidays([]);
      setCalendarState({ loading: false, error: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    fetchMonthData(currentMonth);
  }, [currentMonth, fetchMonthData]);

  useEffect(() => {
    const monthKey = currentMonth.toFormat('yyyy-LL');
    router.replace(`?month=${monthKey}`, { scroll: false });
  }, [currentMonth, router]);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }
    if (!selectedDate.hasSame(currentMonth, 'month')) {
      setSelectedDate(null);
    }
  }, [currentMonth, selectedDate]);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedDate(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDate]);

  const weeks = useMemo(() => buildCalendarMatrix(currentMonth), [currentMonth]);
  const todoBuckets = useMemo(() => bucketTodosByDate(todos), [todos]);
  const holidayBuckets = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    for (const holiday of holidays) {
      const date = DateTime.fromISO(holiday.date, { zone: SINGAPORE_ZONE }).startOf('day');
      if (!date.isValid) {
        continue;
      }
      const key = date.toISODate();
      if (!key) {
        continue;
      }
      const existing = map.get(key);
      if (existing) {
        existing.push(holiday);
      } else {
        map.set(key, [holiday]);
      }
    }
    return map;
  }, [holidays]);

  const selectedKey = selectedDate ? toSingaporeDateKey(selectedDate) : null;
  const selectedTodos = selectedKey ? todoBuckets.get(selectedKey) ?? [] : [];
  const selectedHolidays = selectedKey ? holidayBuckets.get(selectedKey) ?? [] : [];

  const handleSelectDay = useCallback((day: DateTime) => {
    setSelectedDate(day);
    setActionError(null);
  }, []);

  const handleToggleCompletion = useCallback(
    async (todo: Todo) => {
      setActionError(null);
      setUpdatingTodoIds((prev) => [...prev, todo.id]);
      try {
        const response = await fetch(`/api/todos/${todo.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isCompleted: !todo.isCompleted })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({ error: 'Failed to update todo' }));
          throw new Error(payload.error ?? 'Failed to update todo');
        }

        await fetchMonthData(currentMonth);
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setUpdatingTodoIds((prev) => prev.filter((id) => id !== todo.id));
      }
    },
    [currentMonth, fetchMonthData]
  );

  const goToPreviousMonth = useCallback(() => {
    setCurrentMonth((prev) => prev.minus({ months: 1 }).startOf('month'));
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth((prev) => prev.plus({ months: 1 }).startOf('month'));
  }, []);

  const goToCurrentMonth = useCallback(() => {
    setCurrentMonth(getSingaporeNow().setZone(SINGAPORE_ZONE, { keepLocalTime: false }).startOf('month'));
  }, []);

  const monthLabel = currentMonth.toFormat('LLLL yyyy');

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Calendar</h1>
          <p className="text-sm text-slate-400">View upcoming todos and public holidays in Singapore timezone.</p>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          <button
            type="button"
            onClick={goToPreviousMonth}
            className="rounded border border-slate-700 px-3 py-1 text-slate-200 transition hover:border-blue-500 hover:text-blue-200"
          >
            ◀ Previous
          </button>
          <button
            type="button"
            onClick={goToCurrentMonth}
            className="rounded border border-slate-700 px-3 py-1 text-slate-200 transition hover:border-blue-500 hover:text-blue-200"
          >
            Today
          </button>
          <button
            type="button"
            onClick={goToNextMonth}
            className="rounded border border-slate-700 px-3 py-1 text-slate-200 transition hover:border-blue-500 hover:text-blue-200"
          >
            Next ▶
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-100">{monthLabel}</h2>
        <Link
          href="/"
          className="text-xs font-semibold uppercase tracking-wide text-blue-300 hover:text-blue-200"
        >
          Back to dashboard
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-blue-500/40" aria-hidden="true" /> Today
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-slate-800" aria-hidden="true" /> Current month
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-slate-900/40" aria-hidden="true" /> Other months
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-emerald-500/30" aria-hidden="true" /> Holiday
        </span>
      </div>

      {calendarState.error && (
        <div className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {calendarState.error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-800/60">
        <div className="grid grid-cols-7 bg-slate-900/80 text-center text-xs font-semibold uppercase tracking-wide text-slate-300">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="border-b border-slate-800/60 px-2 py-3">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-slate-800/60">
          {weeks.flat().map((day) => {
            const key = day.toISODate() ?? day.toFormat('yyyy-LL-dd');
            const dateKey = toSingaporeDateKey(day);
            const dayTodos = todoBuckets.get(dateKey) ?? [];
            const dayHolidays = holidayBuckets.get(dateKey) ?? [];
            const isCurrentMonth = day.hasSame(currentMonth, 'month');
            const isToday = dateKey === todayKey;
            const isWeekend = day.weekday >= 6;
            const baseClasses = [
              'flex min-h-[120px] flex-col gap-2 rounded-md border border-slate-800/40 p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
              isCurrentMonth ? 'bg-slate-900/70 hover:border-blue-500/60' : 'bg-slate-950/40 text-slate-500',
              isWeekend ? 'bg-slate-900/40' : '',
              isToday ? 'border-blue-500/70 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]' : ''
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSelectDay(day)}
                className={baseClasses}
                aria-label={describeDay(day, dayTodos.length, dayHolidays.map((holiday) => holiday.name))}
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>{day.day}</span>
                  {dayTodos.length > 0 && (
                    <span className="rounded-full border border-blue-500/50 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-200">
                      {dayTodos.length}
                    </span>
                  )}
                </div>

                {dayHolidays.map((holiday) => (
                  <span
                    key={`${holiday.id}-${holiday.date}`}
                    className="inline-flex items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200"
                  >
                    {holiday.name}
                  </span>
                ))}

                <div className="flex flex-col gap-1 overflow-hidden">
                  {dayTodos.slice(0, 3).map((todo) => {
                    const badge = PRIORITY_BADGE_STYLES[todo.priority];
                    return (
                      <div key={todo.id} className="flex items-center gap-2 text-xs text-slate-200">
                        <span
                          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase"
                          style={{
                            backgroundColor: badge.background,
                            borderColor: badge.border,
                            color: badge.text
                          }}
                        >
                          {todo.priority}
                        </span>
                        <span className="truncate">{todo.title}</span>
                      </div>
                    );
                  })}
                  {dayTodos.length > 3 && (
                    <span className="text-[11px] text-slate-400">+{dayTodos.length - 3} more…</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {calendarState.loading && (
        <p className="mt-6 text-sm text-slate-400">Loading calendar…</p>
      )}

      {!calendarState.loading && weeks.length === 0 && (
        <p className="mt-6 text-sm text-slate-400">No data to display for this month.</p>
      )}

      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-slate-100">{selectedDate.toFormat('cccc, dd LLLL yyyy')}</h3>
                <p className="text-sm text-slate-400">{selectedTodos.length === 0 ? 'No todos due on this day.' : `${selectedTodos.length} todo${selectedTodos.length === 1 ? '' : 's'} due`}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="rounded border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300 hover:border-blue-500 hover:text-blue-200"
              >
                Close
              </button>
            </div>

            {selectedHolidays.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedHolidays.map((holiday) => (
                  <span
                    key={holiday.id}
                    className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200"
                  >
                    {holiday.name}
                  </span>
                ))}
              </div>
            )}

            {actionError && (
              <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                {actionError}
              </div>
            )}

            <div className="mt-5 max-h-80 overflow-y-auto pr-2">
              {selectedTodos.length === 0 ? (
                <p className="text-sm text-slate-400">Use the main dashboard to schedule todos for this date.</p>
              ) : (
                <ul className="space-y-3">
                  {selectedTodos.map((todo) => {
                    const badge = PRIORITY_BADGE_STYLES[todo.priority];
                    const timeLabel = formatTodoTime(todo.dueDate ?? null);
                    const isUpdating = updatingTodoIds.includes(todo.id);
                    return (
                      <li key={todo.id} className="rounded border border-slate-800/60 bg-slate-900/80 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase"
                                style={{
                                  backgroundColor: badge.background,
                                  borderColor: badge.border,
                                  color: badge.text
                                }}
                              >
                                {todo.priority}
                              </span>
                              <h4 className="text-sm font-semibold text-slate-100">{todo.title}</h4>
                            </div>
                            {todo.description && (
                              <p className="mt-1 text-xs text-slate-400">{todo.description}</p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              {timeLabel && <span>Due {timeLabel}</span>}
                              {todo.tags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="inline-flex items-center rounded border border-slate-700 px-2 py-0.5 text-[11px] uppercase tracking-wide"
                                  style={{ backgroundColor: tag.color, borderColor: tag.color }}
                                >
                                  <span className="font-semibold" style={{ color: '#0f172a' }}>
                                    {tag.name}
                                  </span>
                                </span>
                              ))}
                              {todo.isRecurring && todo.recurrencePattern && (
                                <span className="rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-200">
                                  Recurs {todo.recurrencePattern}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Link
                              href="/"
                              className="text-xs font-semibold uppercase tracking-wide text-blue-300 hover:text-blue-200"
                            >
                              Open in dashboard
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleToggleCompletion(todo)}
                              disabled={isUpdating}
                              className="rounded border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-blue-500 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isUpdating ? 'Updating…' : todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
