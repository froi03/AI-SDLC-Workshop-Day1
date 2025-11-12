'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Priority = 'high' | 'medium' | 'low';

type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

type ReminderOption = 15 | 30 | 60 | 120 | 1440 | 2880 | 10080;

interface SubtaskStats {
  total: number;
  completed: number;
}

interface TodoWithRelations {
  id: number;
  userId: number;
  title: string;
  description: string;
  dueDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  priority: Priority;
  recurrencePattern: RecurrencePattern | null;
  reminderMinutes: number | null;
  createdAt: string;
  updatedAt: string;
  subtaskStats: SubtaskStats;
  tagIds: number[];
}

interface TodoResponse {
  todo: TodoWithRelations;
}

interface TodosResponse {
  todos: TodoWithRelations[];
}

interface FormState {
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  reminderMinutes: ReminderOption | '';
  recurrencePattern: RecurrencePattern | '';
  repeat: boolean;
}

function initialFormState(): FormState {
  return {
    title: '',
    description: '',
    dueDate: '',
    priority: 'medium',
    reminderMinutes: '',
    recurrencePattern: '',
    repeat: false
  };
}

const priorityCopy: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

const reminderLabels: Record<ReminderOption, string> = {
  15: '15 minutes before',
  30: '30 minutes before',
  60: '1 hour before',
  120: '2 hours before',
  1440: '1 day before',
  2880: '2 days before',
  10080: '1 week before'
};

const recurrenceLabels: Record<RecurrencePattern, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly'
};

function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => value.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDueDate(todo: TodoWithRelations): string {
  if (!todo.dueDate) return 'No due date';
  const due = new Date(todo.dueDate).getTime();
  const now = Date.now();
  const diffMs = due - now;
  const absDiff = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffMs) < minute) {
    return diffMs >= 0 ? 'Due now' : 'Overdue';
  }

  if (absDiff < hour) {
    const value = Math.round(diffMs / minute);
    return diffMs >= 0 ? `Due ${formatter.format(value, 'minute')}` : `${Math.abs(value)} minutes overdue`;
  }

  if (absDiff < day) {
    const value = Math.round(diffMs / hour);
    return diffMs >= 0 ? `Due ${formatter.format(value, 'hour')}` : `${Math.abs(value)} hours overdue`;
  }

  const value = Math.round(diffMs / day);
  if (Math.abs(value) < 7) {
    return diffMs >= 0 ? `Due ${formatter.format(value, 'day')}` : `${Math.abs(value)} days overdue`;
  }

  return new Date(todo.dueDate).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function sortTodos(todos: TodoWithRelations[]): TodoWithRelations[] {
  const priorityOrder: Record<Priority, number> = {
    high: 0,
    medium: 1,
    low: 2
  };

  return [...todos].sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    if (a.dueDate && b.dueDate) {
      const dueDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (dueDiff !== 0) return dueDiff;
    }

    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function splitTodos(todos: TodoWithRelations[]) {
  const now = Date.now();
  const overdue: TodoWithRelations[] = [];
  const pending: TodoWithRelations[] = [];
  const completed: TodoWithRelations[] = [];

  sortTodos(todos).forEach((todo) => {
    if (todo.isCompleted) {
      completed.push(todo);
      return;
    }

    if (todo.dueDate && new Date(todo.dueDate).getTime() < now) {
      overdue.push(todo);
    } else {
      pending.push(todo);
    }
  });

  completed.sort((a, b) => {
    const completedAtA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const completedAtB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return completedAtB - completedAtA;
  });

  return { overdue, pending, completed };
}

export default function HomePage() {
  const [todos, setTodos] = useState<TodoWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTodo, setEditingTodo] = useState<TodoWithRelations | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchTodos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/todos', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to fetch todos');
      }
      const data: TodosResponse = await response.json();
      setTodos(data.todos);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const grouped = useMemo(() => splitTodos(todos), [todos]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        priority: form.priority,
        reminderMinutes: form.reminderMinutes === '' ? null : form.reminderMinutes,
        recurrencePattern: form.repeat ? form.recurrencePattern || null : null
      };

      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await response.json().catch(() => ({ error: 'Failed to create todo' }));
        throw new Error(message.error || 'Failed to create todo');
      }

      const data: TodoResponse = await response.json();
  setTodos((current: TodoWithRelations[]) => sortTodos([data.todo, ...current]));
      setForm(initialFormState());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to create todo');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleComplete = async (todo: TodoWithRelations) => {
    setError(null);
    try {
      const optimistic = {
        ...todo,
        isCompleted: !todo.isCompleted,
        completedAt: !todo.isCompleted ? new Date().toISOString() : null
      };
      setTodos((current: TodoWithRelations[]) =>
        current.map((item: TodoWithRelations) => (item.id === todo.id ? optimistic : item))
      );

      const response = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          isCompleted: !todo.isCompleted,
          completedAt: !todo.isCompleted ? new Date().toISOString() : null
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update todo');
      }

      const data: TodoResponse = await response.json();
      setTodos((current: TodoWithRelations[]) =>
        current.map((item: TodoWithRelations) => (item.id === todo.id ? data.todo : item))
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to update todo');
      // reset on failure
      fetchTodos();
    }
  };

  const handleDelete = async (todo: TodoWithRelations) => {
    setError(null);
  const optimistic = todos.filter((item: TodoWithRelations) => item.id !== todo.id);
    setTodos(optimistic);
    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete todo');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to delete todo');
      fetchTodos();
    }
  };

  const openEditModal = (todo: TodoWithRelations) => {
    setEditingTodo(todo);
    setEditForm({
      title: todo.title,
      description: todo.description,
      dueDate: toDateTimeLocalValue(todo.dueDate),
      priority: todo.priority,
      reminderMinutes: (todo.reminderMinutes as ReminderOption | null) ?? '',
      recurrencePattern: todo.recurrencePattern ?? '',
      repeat: Boolean(todo.recurrencePattern)
    });
  };

  const closeEditModal = () => {
    setEditingTodo(null);
    setEditForm(null);
  };

  const handleEditSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTodo || !editForm) return;
    setIsUpdating(true);
    setError(null);

    try {
      const payload = {
        title: editForm.title,
        description: editForm.description || undefined,
        dueDate: editForm.dueDate ? new Date(editForm.dueDate).toISOString() : null,
        priority: editForm.priority,
        reminderMinutes: editForm.reminderMinutes === '' ? null : editForm.reminderMinutes,
        recurrencePattern: editForm.repeat ? editForm.recurrencePattern || null : null
      };

      const response = await fetch(`/api/todos/${editingTodo.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await response.json().catch(() => ({ error: 'Failed to update todo' }));
        throw new Error(message.error || 'Failed to update todo');
      }

      const data: TodoResponse = await response.json();
      setTodos((current: TodoWithRelations[]) =>
        current.map((item: TodoWithRelations) => (item.id === data.todo.id ? data.todo : item))
      );
      closeEditModal();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to update todo');
    } finally {
      setIsUpdating(false);
    }
  };

  const renderTodoCard = (todo: TodoWithRelations) => {
    const dueLabel = formatDueDate(todo);
    const isOverdue = !todo.isCompleted && todo.dueDate ? new Date(todo.dueDate).getTime() < Date.now() : false;
    const badgeColor =
      todo.priority === 'high'
        ? 'bg-red-500/20 border border-red-400 text-red-300'
        : todo.priority === 'medium'
        ? 'bg-amber-500/20 border border-amber-400 text-amber-200'
        : 'bg-blue-500/20 border border-blue-400 text-blue-200';

    return (
      <article key={todo.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 shadow-lg shadow-slate-950/40">
        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={todo.isCompleted}
                onChange={() => handleToggleComplete(todo)}
                className="size-5 rounded border border-slate-600 bg-slate-800 accent-emerald-500"
              />
              <h3 className={`text-lg font-semibold ${todo.isCompleted ? 'line-through text-slate-400' : 'text-slate-100'}`}>
                {todo.title}
              </h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${badgeColor}`}>
                {priorityCopy[todo.priority]}
              </span>
              {todo.recurrencePattern ? (
                <span className="rounded-full bg-purple-500/20 px-2 py-1 text-xs font-semibold text-purple-200">
                  🔄 {recurrenceLabels[todo.recurrencePattern]}
                </span>
              ) : null}
              {todo.reminderMinutes ? (
                <span className="rounded-full bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-200">
                  🔔 {todo.reminderMinutes >= 60 ? `${todo.reminderMinutes / 60}h` : `${todo.reminderMinutes}m`}
                </span>
              ) : null}
            </div>
            {todo.description ? <p className="ml-8 mt-2 text-sm text-slate-300">{todo.description}</p> : null}
          </div>
          <div className="flex gap-2 md:pt-0 pt-2">
            <button
              type="button"
              onClick={() => openEditModal(todo)}
              className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 transition hover:border-slate-400 hover:text-white"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => handleDelete(todo)}
              className="rounded-lg border border-red-600 px-3 py-1 text-sm text-red-300 transition hover:border-red-400 hover:text-red-200"
            >
              Delete
            </button>
          </div>
        </header>
        <footer className="mt-4 ml-8 text-sm">
          <p className={`${isOverdue ? 'text-rose-300' : 'text-slate-300'}`}>{dueLabel}</p>
          <p className="mt-1 text-xs text-slate-500">
            Created {new Date(todo.createdAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}
          </p>
          {todo.subtaskStats.total > 0 ? (
            <p className="mt-1 text-xs text-slate-400">
              {todo.subtaskStats.completed}/{todo.subtaskStats.total} subtasks completed
            </p>
          ) : null}
        </footer>
      </article>
    );
  };

  const renderSection = (title: string, items: TodoWithRelations[], emptyMessage: string) => (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100">
          {title} <span className="text-sm text-slate-400">({items.length})</span>
        </h2>
      </header>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-400">
          {emptyMessage}
        </p>
      ) : (
        <div className="space-y-3">{items.map(renderTodoCard)}</div>
      )}
    </section>
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-24 pt-16">
      <header className="flex flex-col gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.4em] text-emerald-300/70">Todos</p>
          <h1 className="mt-2 text-4xl font-semibold text-white">Stay ahead with a focused command center</h1>
        </div>
        <p className="max-w-2xl text-sm text-slate-300">
          Capture, prioritise, and conquer your workload. Every timestamp honours Asia/Singapore, recurring tasks stay in sync,
          and reminders keep you honest. Start by dropping a title and we will handle the flow.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/40">
        <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2 md:gap-6">
          <div className="md:col-span-2">
            <label htmlFor="title" className="block text-sm font-medium text-slate-200">
              Title
            </label>
            <input
              id="title"
              name="title"
              required
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Plan quarterly review, prepare deck, ..."
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-slate-200">
              Description <span className="text-slate-500">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Add detail that helps future you move faster"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium text-slate-200">
              Due date <span className="text-slate-500">(Singapore time)</span>
            </label>
            <input
              id="dueDate"
              name="dueDate"
              type="datetime-local"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
              min={toDateTimeLocalValue(new Date().toISOString())}
            />
          </div>

          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-slate-200">
              Priority
            </label>
            <select
              id="priority"
              name="priority"
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as Priority }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div>
            <label htmlFor="reminder" className="block text-sm font-medium text-slate-200">
              Reminder
            </label>
            <select
              id="reminder"
              name="reminder"
              disabled={!form.dueDate}
              value={form.reminderMinutes === '' ? '' : String(form.reminderMinutes)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reminderMinutes: event.target.value === '' ? '' : (Number(event.target.value) as ReminderOption)
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner disabled:cursor-not-allowed disabled:opacity-50 focus:border-emerald-400 focus:outline-none"
            >
              <option value="">No reminder</option>
              {Object.entries(reminderLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-200">Recurring</label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="repeat"
                name="repeat"
                type="checkbox"
                checked={form.repeat}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    repeat: event.target.checked,
                    recurrencePattern: event.target.checked ? current.recurrencePattern : ''
                  }))
                }
                className="size-4 rounded border border-slate-600 bg-slate-800 accent-emerald-500"
              />
              <label htmlFor="repeat" className="text-sm text-slate-300">
                Repeat this todo
              </label>
            </div>
            <select
              id="recurrencePattern"
              name="recurrencePattern"
              disabled={!form.repeat}
              value={form.recurrencePattern === '' ? '' : form.recurrencePattern}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  recurrencePattern: event.target.value === '' ? '' : (event.target.value as RecurrencePattern)
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner disabled:cursor-not-allowed disabled:opacity-50 focus:border-emerald-400 focus:outline-none"
            >
              <option value="">Select pattern</option>
              {Object.entries(recurrenceLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 flex items-center justify-between">
            {error ? <p className="text-sm text-rose-300">{error}</p> : <span />}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-emerald-500 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Saving...' : 'Add todo'}
            </button>
          </div>
        </form>
      </section>

      {isLoading ? (
        <p className="text-center text-sm text-slate-400">Loading todos...</p>
      ) : (
        <div className="space-y-10">
          {renderSection('Overdue', grouped.overdue, 'Every deadline is under control — nothing overdue right now.')}
          {renderSection('Pending', grouped.pending, 'Add a todo to get started. Your next win is one keystroke away.')}
          {renderSection('Completed', grouped.completed, "Completed todos will collect here. Celebrate the progress.")}
        </div>
      )}

      {editingTodo && editForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Edit todo</h2>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
              >
                Close
              </button>
            </header>
            <form onSubmit={handleEditSubmit} className="grid gap-4 md:grid-cols-2 md:gap-6">
              <div className="md:col-span-2">
                <label htmlFor="edit-title" className="block text-sm font-medium text-slate-200">
                  Title
                </label>
                <input
                  id="edit-title"
                  required
                  value={editForm.title}
                  onChange={(event) =>
                    setEditForm((current) =>
                      current ? { ...current, title: event.target.value } : current
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="edit-description" className="block text-sm font-medium text-slate-200">
                  Description
                </label>
                <textarea
                  id="edit-description"
                  rows={3}
                  value={editForm.description}
                  onChange={(event) =>
                    setEditForm((current) =>
                      current ? { ...current, description: event.target.value } : current
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="edit-dueDate" className="block text-sm font-medium text-slate-200">
                  Due date
                </label>
                <input
                  id="edit-dueDate"
                  type="datetime-local"
                  value={editForm.dueDate}
                  onChange={(event) =>
                    setEditForm((current) =>
                      current ? { ...current, dueDate: event.target.value } : current
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="edit-priority" className="block text-sm font-medium text-slate-200">
                  Priority
                </label>
                <select
                  id="edit-priority"
                  value={editForm.priority}
                  onChange={(event) =>
                    setEditForm((current) =>
                      current ? { ...current, priority: event.target.value as Priority } : current
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner focus:border-emerald-400 focus:outline-none"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label htmlFor="edit-reminder" className="block text-sm font-medium text-slate-200">
                  Reminder
                </label>
                <select
                  id="edit-reminder"
                  disabled={!editForm.dueDate}
                  value={editForm.reminderMinutes === '' ? '' : String(editForm.reminderMinutes)}
                  onChange={(event) =>
                    setEditForm((current) =>
                      current
                        ? {
                            ...current,
                            reminderMinutes:
                              event.target.value === '' ? '' : (Number(event.target.value) as ReminderOption)
                          }
                        : current
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner disabled:cursor-not-allowed disabled:opacity-50 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">No reminder</option>
                  {Object.entries(reminderLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200">Recurring</label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="edit-repeat"
                    type="checkbox"
                    checked={editForm.repeat}
                    onChange={(event) =>
                      setEditForm((current) =>
                        current
                          ? {
                              ...current,
                              repeat: event.target.checked,
                              recurrencePattern: event.target.checked ? current.recurrencePattern : ''
                            }
                          : current
                      )
                    }
                    className="size-4 rounded border border-slate-600 bg-slate-800 accent-emerald-500"
                  />
                  <label htmlFor="edit-repeat" className="text-sm text-slate-300">
                    Repeat this todo
                  </label>
                </div>
                <select
                  id="edit-recurrencePattern"
                  disabled={!editForm.repeat}
                  value={editForm.recurrencePattern === '' ? '' : editForm.recurrencePattern}
                  onChange={(event) =>
                    setEditForm((current) =>
                      current
                        ? {
                            ...current,
                            recurrencePattern:
                              event.target.value === '' ? '' : (event.target.value as RecurrencePattern)
                          }
                        : current
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-inner disabled:cursor-not-allowed disabled:opacity-50 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">Select pattern</option>
                  {Object.entries(recurrenceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 flex items-center justify-between">
                {error ? <p className="text-sm text-rose-300">{error}</p> : <span />}
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="rounded-lg bg-emerald-500 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUpdating ? 'Updating...' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
