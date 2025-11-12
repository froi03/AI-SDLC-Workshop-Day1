'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { DateTime } from 'luxon';
import type { Priority, RecurrencePattern, Todo } from '@/lib/db';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';

const priorityOptions: Priority[] = ['high', 'medium', 'low'];
const recurrenceOptions: RecurrencePattern[] = ['daily', 'weekly', 'monthly', 'yearly'];
const reminderOptions = [15, 30, 60, 120, 1440, 2880, 10080];

interface CreateTodoForm {
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern;
  reminderMinutes: string;
}

interface UiState {
  loading: boolean;
  error: string | null;
}

const INITIAL_FORM: CreateTodoForm = {
  title: '',
  description: '',
  priority: 'medium',
  dueDate: '',
  isRecurring: false,
  recurrencePattern: 'daily',
  reminderMinutes: ''
};

function toSingaporeIso(value: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = DateTime.fromISO(value, { zone: 'Asia/Singapore' });
  if (!parsed.isValid) {
    return null;
  }

  const iso = parsed.toUTC().toISO();
  return iso ?? null;
}

function toDatetimeLocal(value: string | null): string {
  if (!value) {
    return '';
  }
  const dt = DateTime.fromISO(value).setZone('Asia/Singapore');
  return dt.toFormat("yyyy-LL-dd'T'HH:mm");
}

function groupTodos(todos: Todo[]) {
  const now = getSingaporeNow();
  const overdue: Todo[] = [];
  const active: Todo[] = [];
  const completed: Todo[] = [];

  for (const todo of todos) {
    if (todo.isCompleted) {
      completed.push(todo);
      continue;
    }

    if (todo.dueDate) {
      const due = DateTime.fromISO(todo.dueDate).setZone('Asia/Singapore');
      if (due.isValid && due < now) {
        overdue.push(todo);
        continue;
      }
    }

    active.push(todo);
  }

  const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

  const byPriority = (a: Todo, b: Todo) => {
    const rankA = priorityRank[a.priority];
    const rankB = priorityRank[b.priority];
    if (rankA !== rankB) {
      return rankA - rankB;
    }

    if (!a.dueDate && !b.dueDate) {
      return a.id - b.id;
    }

    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;

    const dueA = DateTime.fromISO(a.dueDate).setZone('Asia/Singapore');
    const dueB = DateTime.fromISO(b.dueDate).setZone('Asia/Singapore');
    return dueA.toMillis() - dueB.toMillis();
  };

  overdue.sort((a, b) => {
    const dueA = a.dueDate
      ? DateTime.fromISO(a.dueDate).setZone('Asia/Singapore')
      : DateTime.fromMillis(0, { zone: 'Asia/Singapore' });
    const dueB = b.dueDate
      ? DateTime.fromISO(b.dueDate).setZone('Asia/Singapore')
      : DateTime.fromMillis(0, { zone: 'Asia/Singapore' });
    return dueA.toMillis() - dueB.toMillis();
  });
  active.sort(byPriority);
  completed.sort((a, b) => {
    const aCompleted = a.completedAt ? DateTime.fromISO(a.completedAt).setZone('Asia/Singapore').toMillis() : 0;
    const bCompleted = b.completedAt ? DateTime.fromISO(b.completedAt).setZone('Asia/Singapore').toMillis() : 0;
    return bCompleted - aCompleted;
  });

  return { overdue, active, completed };
}

function singaporeNowUtcIso(): string {
  const iso = getSingaporeNow().toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to derive Singapore timestamp');
  }
  return iso;
}

export default function TodoPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [uiState, setUiState] = useState<UiState>({ loading: true, error: null });
  const [createForm, setCreateForm] = useState<CreateTodoForm>(INITIAL_FORM);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [editErrors, setEditErrors] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadTodos = useCallback(async () => {
    setUiState((prev) => ({ ...prev, loading: true }));
    try {
      const response = await fetch('/api/todos', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load todos');
      }
      const data = await response.json();
      setTodos(data.todos ?? []);
      setUiState({ loading: false, error: null });
    } catch (error) {
      setUiState({ loading: false, error: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  const sections = useMemo(() => groupTodos(todos), [todos]);

  const updateCreateForm = (updates: Partial<CreateTodoForm>) => {
    setCreateForm((prev) => ({ ...prev, ...updates }));
  };

  const handleCreateTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);

    const dueDateIso = toSingaporeIso(createForm.dueDate);
    const payload = {
      title: createForm.title.trim(),
      description: createForm.description.trim(),
      priority: createForm.priority,
      dueDate: dueDateIso,
      isRecurring: createForm.isRecurring,
      recurrencePattern: createForm.isRecurring ? createForm.recurrencePattern : null,
      reminderMinutes: createForm.reminderMinutes ? Number(createForm.reminderMinutes) : null
    };

    const optimisticTimestamp = singaporeNowUtcIso();

    const optimisticTodo: Todo = {
      id: Math.max(0, ...todos.map((todo) => todo.id)) + 1,
      userId: 1,
      title: payload.title,
      description: payload.description,
      priority: payload.priority,
      dueDate: payload.dueDate,
      isCompleted: false,
      completedAt: null,
      isRecurring: payload.isRecurring,
      recurrencePattern: payload.recurrencePattern,
      reminderMinutes: payload.reminderMinutes,
      createdAt: optimisticTimestamp,
      updatedAt: optimisticTimestamp
    };

    setTodos((prev) => [optimisticTodo, ...prev]);

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to create todo' }));
        throw new Error(data.error ?? 'Failed to create todo');
      }

      const data = await response.json();
      setTodos((prev) => [data.todo as Todo, ...prev.filter((todo) => todo.id !== optimisticTodo.id)]);
      setCreateForm(INITIAL_FORM);
    } catch (error) {
      setTodos((prev) => prev.filter((todo) => todo.id !== optimisticTodo.id));
      setCreateError((error as Error).message);
    }
  };

  const handleToggle = async (todo: Todo) => {
    const updated: Todo = {
      ...todo,
      isCompleted: !todo.isCompleted,
      completedAt: todo.isCompleted ? null : singaporeNowUtcIso()
    };
    setTodos((prev) => prev.map((item) => (item.id === todo.id ? updated : item)));

    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: !todo.isCompleted })
      });

      if (!response.ok) {
        throw new Error('Failed to update todo');
      }

      const data = await response.json();
      setTodos((prev) => prev.map((item) => (item.id === todo.id ? (data.todo as Todo) : item)));
    } catch (error) {
      setTodos((prev) => prev.map((item) => (item.id === todo.id ? todo : item)));
      console.error(error);
    }
  };

  const handleDelete = async (todo: Todo) => {
    const current = todos;
    setTodos((prev) => prev.filter((item) => item.id !== todo.id));

    try {
      const response = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to delete todo');
      }
    } catch (error) {
      console.error(error);
      setTodos(current);
    }
  };

  const openEdit = (todo: Todo) => {
    setEditing(todo);
    setEditErrors(null);
  };

  const closeEdit = () => {
    setEditing(null);
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;

    const formData = new FormData(event.currentTarget);
    const title = (formData.get('title') as string).trim();
    const description = ((formData.get('description') as string) ?? '').trim();
    const priority = formData.get('priority') as Priority;
    const dueDate = formData.get('dueDate') as string;
    const isRecurring = formData.get('isRecurring') === 'on';
    const recurrencePattern = formData.get('recurrencePattern') as RecurrencePattern | null;
    const reminder = formData.get('reminderMinutes') as string;

    const payload = {
      title,
      description,
      priority,
      dueDate: dueDate ? toSingaporeIso(dueDate) : null,
      isRecurring,
      recurrencePattern: isRecurring ? recurrencePattern : null,
      reminderMinutes: reminder ? Number(reminder) : null
    };

    setTodos((prev) => prev.map((item) => (item.id === editing.id ? { ...item, ...payload } : item)));

    try {
      const response = await fetch(`/api/todos/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to update todo' }));
        throw new Error(data.error ?? 'Failed to update todo');
      }

      const data = await response.json();
      setTodos((prev) => prev.map((item) => (item.id === editing.id ? (data.todo as Todo) : item)));
      closeEdit();
    } catch (error) {
      setEditErrors((error as Error).message);
      loadTodos();
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Todo Dashboard</h1>
        <p className="text-sm text-slate-300">All times in Singapore timezone (Asia/Singapore).</p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow">
        <h2 className="text-xl font-semibold">Create Todo</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleCreateTodo}>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              name="title"
              value={createForm.title}
              onChange={(event) => updateCreateForm({ title: event.target.value })}
              maxLength={200}
              required
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              placeholder="Plan quarterly review"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={createForm.description}
              onChange={(event) => updateCreateForm({ description: event.target.value })}
              maxLength={2000}
              className="min-h-[80px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="priority">
                Priority
              </label>
              <select
                id="priority"
                name="priority"
                value={createForm.priority}
                onChange={(event) => updateCreateForm({ priority: event.target.value as Priority })}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              >
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {option.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="dueDate">
                Due Date (Singapore)
              </label>
              <input
                type="datetime-local"
                id="dueDate"
                name="dueDate"
                value={createForm.dueDate}
                onChange={(event) => updateCreateForm({ dueDate: event.target.value })}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-950/40 p-4">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={createForm.isRecurring}
                onChange={(event) => updateCreateForm({ isRecurring: event.target.checked })}
              />
              Repeat this todo
            </label>

            {createForm.isRecurring && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="recurrencePattern">
                    Recurrence Pattern
                  </label>
                  <select
                    id="recurrencePattern"
                    value={createForm.recurrencePattern}
                    onChange={(event) => updateCreateForm({ recurrencePattern: event.target.value as RecurrencePattern })}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  >
                    {recurrenceOptions.map((option) => (
                      <option key={option} value={option}>
                        {option.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="reminderMinutes">
                    Reminder
                  </label>
                  <select
                    id="reminderMinutes"
                    value={createForm.reminderMinutes}
                    onChange={(event) => updateCreateForm({ reminderMinutes: event.target.value })}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  >
                    <option value="">No reminder</option>
                    {reminderOptions.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`} before
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {!createForm.isRecurring && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="reminderMinutesStandalone">
                  Reminder
                </label>
                <select
                  id="reminderMinutesStandalone"
                  value={createForm.reminderMinutes}
                  onChange={(event) => updateCreateForm({ reminderMinutes: event.target.value })}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  <option value="">No reminder</option>
                  {reminderOptions.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`} before
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {createError && <p className="text-sm text-red-400">{createError}</p>}

          <button
            type="submit"
            className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Create Todo
          </button>
        </form>
      </section>

      {uiState.loading && <p>Loading todos…</p>}
      {uiState.error && <p className="text-sm text-red-400">{uiState.error}</p>}

      <section className="flex flex-col gap-8">
        <TodoSection
          title="Overdue"
          description="Tasks past their due date"
          emptyMessage="Nothing overdue — great job!"
          todos={sections.overdue}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
        <TodoSection
          title="Active"
          description="Upcoming and ongoing tasks"
          emptyMessage="No active todos. Time to add some!"
          todos={sections.active}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
        <TodoSection
          title="Completed"
          description="Finished tasks"
          emptyMessage="No completed todos yet."
          todos={sections.completed}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </section>

      {editing && (
        <dialog open className="fixed inset-0 flex items-center justify-center bg-black/60">
          <form
            className="w-full max-w-xl rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
            onSubmit={handleEditSubmit}
          >
            <h2 className="text-xl font-semibold">Edit Todo</h2>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-2 text-sm">
                Title
                <input
                  name="title"
                  defaultValue={editing.title}
                  required
                  maxLength={200}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Description
                <textarea
                  name="description"
                  defaultValue={editing.description}
                  maxLength={2000}
                  className="min-h-[80px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Priority
                <select
                  name="priority"
                  defaultValue={editing.priority}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  {priorityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Due Date (Singapore)
                <input
                  type="datetime-local"
                  name="dueDate"
                  defaultValue={toDatetimeLocal(editing.dueDate)}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="isRecurring" defaultChecked={editing.isRecurring} />
                Repeat this todo
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Recurrence Pattern
                <select
                  name="recurrencePattern"
                  defaultValue={editing.recurrencePattern ?? 'daily'}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  {recurrenceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Reminder
                <select
                  name="reminderMinutes"
                  defaultValue={editing.reminderMinutes ?? ''}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  <option value="">No reminder</option>
                  {reminderOptions.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`} before
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {editErrors && <p className="mt-2 text-sm text-red-400">{editErrors}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded border border-slate-700 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                Save Changes
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}

interface TodoSectionProps {
  title: string;
  description: string;
  emptyMessage: string;
  todos: Todo[];
  onToggle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

function TodoSection({ title, description, emptyMessage, todos, onToggle, onEdit, onDelete }: TodoSectionProps) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-slate-400">{description}</p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{todos.length}</span>
      </header>

      {todos.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {todos.map((todo) => (
            <li key={todo.id} className="rounded border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <label className="flex flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={todo.isCompleted}
                    onChange={() => onToggle(todo)}
                    className="mt-1"
                    aria-label={`Mark ${todo.title} as ${todo.isCompleted ? 'incomplete' : 'complete'}`}
                  />
                  <div className="flex-1">
                    <h3 className="text-base font-medium">{todo.title}</h3>
                    {todo.description && <p className="mt-1 text-sm text-slate-300">{todo.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span className={`rounded px-2 py-1 font-semibold uppercase text-slate-900`} style={{ backgroundColor: priorityColor(todo.priority) }}>
                        {todo.priority}
                      </span>
                      <span>{todo.dueDate ? `Due ${formatSingaporeDate(todo.dueDate)}` : 'No due date'}</span>
                      {todo.isRecurring && todo.recurrencePattern && <span className="rounded border border-blue-500/40 px-2 py-1 text-blue-300">Repeats {todo.recurrencePattern}</span>}
                      {todo.reminderMinutes != null && <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">Reminder {todo.reminderMinutes}m</span>}
                    </div>
                  </div>
                </label>
                <div className="flex flex-col gap-2">
                  <button
                    className="rounded border border-slate-700 px-3 py-1 text-xs"
                    onClick={() => onEdit(todo)}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded border border-red-600 px-3 py-1 text-xs text-red-200"
                    onClick={() => onDelete(todo)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function priorityColor(priority: Priority) {
  switch (priority) {
    case 'high':
      return '#ef4444';
    case 'medium':
      return '#f59e0b';
    case 'low':
    default:
      return '#3b82f6';
  }
}
