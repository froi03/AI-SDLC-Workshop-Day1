'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const priorityOrder: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2
};

const priorityLabels: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

const priorityBadgeClasses: Record<Priority, string> = {
  high: 'border border-red-500/60 bg-red-500/10 text-red-200',
  medium: 'border border-amber-500/60 bg-amber-500/10 text-amber-200',
  low: 'border border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
};

type Priority = 'high' | 'medium' | 'low';
type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

type CalendarTag = {
  id: number;
  name: string;
  color: string;
};

type CalendarTodo = {
  id: number;
  title: string;
  description: string;
  dueDate: string | null;
  priority: Priority;
  isCompleted: boolean;
  recurrencePattern: RecurrencePattern | null;
  reminderMinutes: number | null;
  tagIds: number[];
  subtasks: Array<{ id: number }>;
};

type CalendarHoliday = {
  id: number;
  date: string;
  name: string;
};

type CalendarCell = {
  isoDate: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  holiday?: CalendarHoliday;
  todos: CalendarTodo[];
};

function splitIntoWeeks(cells: CalendarCell[]): CalendarCell[][] {
  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => getSingaporeNow().startOf('month'));
  const [todos, setTodos] = useState<CalendarTodo[]>([]);
  const [tags, setTags] = useState<CalendarTag[]>([]);
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthLabel = useMemo(() => currentMonth.toFormat('MMMM yyyy'), [currentMonth]);
  const todayKey = useMemo(() => getSingaporeNow().startOf('day').toISODate() ?? '', []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadData() {
      setLoading(true);
      setError(null);

      const monthStart = currentMonth.startOf('month');
      const monthEnd = currentMonth.endOf('month');
      const from = monthStart.toISODate();
      const to = monthEnd.toISODate();
      const monthQuery = monthStart.toFormat('yyyy-LL');

      if (!from || !to) {
        setLoading(false);
        return;
      }

      try {
        const [todoResponse, holidayResponse] = await Promise.all([
          fetch(`/api/todos?from=${from}&to=${to}`, { signal: controller.signal }),
          fetch(`/api/holidays?month=${monthQuery}`, { signal: controller.signal })
        ]);

        if (!active) {
          return;
        }

        if (!todoResponse.ok) {
          const data = (await todoResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Failed to load todos');
        }

        if (!holidayResponse.ok) {
          const data = (await holidayResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Failed to load holidays');
        }

        const todoPayload = (await todoResponse.json()) as {
          todos?: CalendarTodo[];
          tags?: CalendarTag[];
        };
        const holidayPayload = (await holidayResponse.json()) as {
          holidays?: CalendarHoliday[];
        };

        if (!active) {
          return;
        }

        setTodos(Array.isArray(todoPayload.todos) ? todoPayload.todos : []);
        setTags(Array.isArray(todoPayload.tags) ? todoPayload.tags : []);
        setHolidays(Array.isArray(holidayPayload.holidays) ? holidayPayload.holidays : []);
      } catch (fetchError) {
        if (!active) {
          return;
        }
        setError((fetchError as Error).message ?? 'Failed to load calendar data');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      active = false;
      controller.abort();
    };
  }, [currentMonth]);

  const tagMap = useMemo(() => {
    const map = new Map<number, CalendarTag>();
    tags.forEach((tag) => {
      map.set(tag.id, tag);
    });
    return map;
  }, [tags]);

  const holidayMap = useMemo(() => {
    const map = new Map<string, CalendarHoliday>();
    holidays.forEach((holiday) => {
      map.set(holiday.date, holiday);
    });
    return map;
  }, [holidays]);

  const todoMap = useMemo(() => {
    const map = new Map<string, CalendarTodo[]>();
    todos.forEach((todo) => {
      if (!todo.dueDate) {
        return;
      }
      const dateKey = DateTime.fromISO(todo.dueDate).setZone('Asia/Singapore').toISODate();
      if (!dateKey) {
        return;
      }
      const list = map.get(dateKey) ?? [];
      list.push(todo);
      map.set(dateKey, list);
    });

    for (const [, list] of map) {
      list.sort((a, b) => {
        if (a.priority !== b.priority) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        if (a.dueDate && b.dueDate) {
          return DateTime.fromISO(a.dueDate).toMillis() - DateTime.fromISO(b.dueDate).toMillis();
        }
        return a.id - b.id;
      });
    }

    return map;
  }, [todos]);

  const calendarCells = useMemo(() => {
    const startOfMonth = currentMonth.startOf('month');
    const endOfMonth = currentMonth.endOf('month');
    const startOffset = startOfMonth.weekday % 7;
    const gridStart = startOfMonth.minus({ days: startOffset });
    const endOffset = endOfMonth.weekday % 7;
    const extraDays = endOffset === 0 ? 0 : 7 - endOffset;
    const gridEnd = endOfMonth.plus({ days: extraDays });

    const cells: CalendarCell[] = [];
    let cursor = gridStart;
    const endMillis = gridEnd.toMillis();

    while (cursor.toMillis() <= endMillis) {
      const isoDate = cursor.toISODate();
      if (isoDate) {
        cells.push({
          isoDate,
          dayNumber: cursor.day,
          isCurrentMonth: cursor.hasSame(currentMonth, 'month'),
          isToday: isoDate === todayKey,
          holiday: holidayMap.get(isoDate),
          todos: todoMap.get(isoDate) ?? []
        });
      }
      cursor = cursor.plus({ days: 1 });
    }

    return splitIntoWeeks(cells);
  }, [currentMonth, holidayMap, todoMap, todayKey]);

  const selectedTodos = useMemo(() => (selectedDate ? todoMap.get(selectedDate) ?? [] : []), [selectedDate, todoMap]);
  const selectedHoliday = selectedDate ? holidayMap.get(selectedDate) : undefined;
  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) {
      return '';
    }
    const parsed = DateTime.fromISO(selectedDate, { zone: 'Asia/Singapore' });
    if (!parsed.isValid) {
      return selectedDate;
    }
    return parsed.toFormat('dd MMM yyyy');
  }, [selectedDate]);

  const closeModal = useCallback(() => setSelectedDate(null), []);

  const goToPreviousMonth = useCallback(() => {
    setCurrentMonth((value) => value.minus({ months: 1 }).startOf('month'));
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth((value) => value.plus({ months: 1 }).startOf('month'));
  }, []);

  const goToCurrentMonth = useCallback(() => {
    setCurrentMonth(getSingaporeNow().startOf('month'));
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Calendar</h1>
          <p className="text-sm text-slate-300">View todos by due date in Singapore timezone.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
          >
            Back to Dashboard
          </Link>
          <button
            type="button"
            onClick={goToPreviousMonth}
            className="rounded border border-slate-700 px-4 py-2 text-sm transition hover:border-slate-500"
            data-testid="calendar-prev"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={goToCurrentMonth}
            className="rounded border border-blue-500 px-4 py-2 text-sm text-blue-200 transition hover:bg-blue-500/10"
            data-testid="calendar-today"
          >
            Today
          </button>
          <button
            type="button"
            onClick={goToNextMonth}
            className="rounded border border-slate-700 px-4 py-2 text-sm transition hover:border-slate-500"
            data-testid="calendar-next"
          >
            Next
          </button>
        </div>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold" data-testid="calendar-month-label">
            {monthLabel}
          </h2>
          {loading && <span className="text-sm text-slate-400">Loading...</span>}
        </div>

        {error && (
          <div className="mt-4 rounded border border-red-600 bg-red-900/20 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div
          className="mt-6 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-400"
          data-testid="calendar-weekdays"
        >
          {WEEKDAYS.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-7 gap-2" role="grid" data-testid="calendar-grid">
          {calendarCells.map((week, weekIndex) => (
            <Fragment key={`week-${weekIndex}`}>
              {week.map((day) => {
                const hasTodos = day.todos.length > 0;
                const tagCount = day.todos.reduce((acc, todo) => acc + todo.tagIds.length, 0);
                const buttonClasses = [
                  'flex h-28 flex-col gap-2 rounded border px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-400',
                  day.isCurrentMonth ? 'border-slate-800 bg-slate-950 hover:border-slate-600' : 'border-slate-800 bg-slate-900/40 text-slate-500',
                  day.isToday ? 'border-blue-500 text-blue-200' : '',
                  day.holiday ? 'border-emerald-600/70 bg-emerald-950/30 text-emerald-200' : '',
                  selectedDate === day.isoDate ? 'ring-2 ring-blue-400' : ''
                ]
                  .filter(Boolean)
                  .join(' ');

                const ariaLabel = [
                  DateTime.fromISO(day.isoDate, { zone: 'Asia/Singapore' }).toFormat('cccc, dd MMM yyyy'),
                  day.holiday ? `Holiday: ${day.holiday.name}` : null,
                  hasTodos ? `${day.todos.length} todos due` : 'No todos due'
                ]
                  .filter(Boolean)
                  .join('. ');

                return (
                  <button
                    type="button"
                    key={day.isoDate}
                    className={buttonClasses}
                    onClick={() => setSelectedDate(day.isoDate)}
                    data-testid={`calendar-day-${day.isoDate}`}
                    aria-label={ariaLabel}
                  >
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>{day.dayNumber}</span>
                      {day.isToday && <span className="text-xs font-normal text-blue-300">Today</span>}
                    </div>
                    <div className="flex flex-col gap-1 text-xs">
                      {day.holiday && <span className="font-medium text-emerald-300">{day.holiday.name}</span>}
                      {hasTodos ? (
                        <span className="inline-flex items-center gap-2 text-slate-300">
                          <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200">
                            {day.todos.length} {day.todos.length === 1 ? 'todo' : 'todos'}
                          </span>
                          {tagCount > 0 && (
                            <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                              {tagCount} tag{tagCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-500">No todos</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </section>

      {selectedDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          data-testid="calendar-day-modal"
        >
          <div className="w-full max-w-xl rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selectedDateLabel}</h2>
                {selectedHoliday && <p className="text-sm text-emerald-300">Holiday: {selectedHoliday.name}</p>}
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            {selectedTodos.length === 0 ? (
              <p className="mt-6 text-sm text-slate-400">No todos due on this date.</p>
            ) : (
              <ul className="mt-6 flex flex-col gap-4">
                {selectedTodos.map((todo) => (
                  <li key={todo.id} className="rounded border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-base font-medium text-slate-100">{todo.title}</p>
                        {todo.description && <p className="text-sm text-slate-300">{todo.description}</p>}
                      </div>
                      <span className={`inline-flex items-center justify-center rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide ${priorityBadgeClasses[todo.priority]}`}>
                        {priorityLabels[todo.priority]}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                      <span>{todo.isCompleted ? 'Completed' : 'Pending'}</span>
                      <span>Due {formatSingaporeDate(todo.dueDate)}</span>
                      {todo.recurrencePattern && <span className="rounded border border-blue-500/40 px-2 py-1 text-blue-200">Repeats {todo.recurrencePattern}</span>}
                      {todo.reminderMinutes != null && (
                        <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">
                          Reminder {todo.reminderMinutes >= 60 ? `${todo.reminderMinutes / 60}h` : `${todo.reminderMinutes}m`} before
                        </span>
                      )}
                      {todo.tagIds.map((tagId) => {
                        const tag = tagMap.get(tagId);
                        if (!tag) {
                          return null;
                        }
                        return (
                          <span
                            key={tagId}
                            className="rounded border px-2 py-1"
                            style={{ borderColor: tag.color, color: tag.color }}
                            aria-label={`Tag ${tag.name}`}
                          >
                            {tag.name}
                          </span>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
