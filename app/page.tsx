'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { DateTime } from 'luxon';
import type { Priority, RecurrencePattern, Tag, TagWithCounts, Todo } from '@/lib/db';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';

const priorityOptions: Priority[] = ['high', 'medium', 'low'];
type PriorityFilter = 'all' | Priority;
const priorityFilterOptions: PriorityFilter[] = ['all', 'high', 'medium', 'low'];
const recurrenceOptions: RecurrencePattern[] = ['daily', 'weekly', 'monthly', 'yearly'];
const reminderOptions = [15, 30, 60, 120, 1440, 2880, 10080];
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

const PRIORITY_BADGE_STYLES: Record<Priority, { background: string; border: string; text: string }> = {
  high: { background: '#ef4444', border: '#b91c1c', text: '#0f172a' },
  medium: { background: '#f59e0b', border: '#b45309', text: '#0f172a' },
  low: { background: '#3b82f6', border: '#1d4ed8', text: '#0f172a' }
};

const DEFAULT_TAG_COLOR = '#3B82F6';

function stripCounts(tag: TagWithCounts): Tag {
  const { todoCount: _count, ...rest } = tag;
  return rest;
}

function getContrastingTextColor(hex: string): string {
  const candidate = HEX_COLOR_REGEX.test(hex) ? hex : '#1f2937';
  const parsed = candidate.replace('#', '');
  const r = Number.parseInt(parsed.substring(0, 2), 16) / 255;
  const g = Number.parseInt(parsed.substring(2, 4), 16) / 255;
  const b = Number.parseInt(parsed.substring(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '#0f172a' : '#f8fafc';
}

function getTagBadgeStyle(color: string) {
  const normalized = HEX_COLOR_REGEX.test(color) ? color.toUpperCase() : '#475569';
  return {
    backgroundColor: normalized,
    borderColor: normalized,
    color: getContrastingTextColor(normalized)
  };
}

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

interface CreateTodoForm {
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern;
  reminderMinutes: string;
  tagIds: number[];
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
  reminderMinutes: '',
  tagIds: []
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

  const byPriority = (a: Todo, b: Todo) => {
    const rankA = PRIORITY_RANK[a.priority];
    const rankB = PRIORITY_RANK[b.priority];
    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const dueA = a.dueDate ? DateTime.fromISO(a.dueDate).setZone('Asia/Singapore') : null;
    const dueB = b.dueDate ? DateTime.fromISO(b.dueDate).setZone('Asia/Singapore') : null;

    if (dueA && dueB) {
      const diff = dueA.toMillis() - dueB.toMillis();
      if (diff !== 0) {
        return diff;
      }
    } else if (dueA) {
      return -1;
    } else if (dueB) {
      return 1;
    }

    return a.id - b.id;
  };

  overdue.sort(byPriority);
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
  const [createForm, setCreateForm] = useState<CreateTodoForm>({ ...INITIAL_FORM });
  const [editing, setEditing] = useState<Todo | null>(null);
  const [editErrors, setEditErrors] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [tags, setTags] = useState<TagWithCounts[]>([]);
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [isTagModalOpen, setTagModalOpen] = useState(false);
  const [tagForm, setTagForm] = useState({ name: '', color: DEFAULT_TAG_COLOR, description: '' });
  const [tagFormError, setTagFormError] = useState<string | null>(null);
  const [tagSubmitting, setTagSubmitting] = useState(false);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [tagDeleteTarget, setTagDeleteTarget] = useState<TagWithCounts | null>(null);
  const [tagDeleteLoading, setTagDeleteLoading] = useState(false);
  const [editingTagSelection, setEditingTagSelection] = useState<number[]>([]);
  const {
    isSupported: notificationsSupported,
    permission: notificationPermission,
    isPolling: notificationsPolling,
    error: notificationsError,
    enableNotifications
  } = useNotifications();

  const notificationsEnabled = notificationsSupported && notificationPermission === 'granted';
  const notificationsDenied = notificationsSupported && notificationPermission === 'denied';

  const syncTodosWithTagList = useCallback((tagList: TagWithCounts[]) => {
    const tagMap = new Map<number, Tag>(tagList.map((tag) => [tag.id, stripCounts(tag)]));
    setTodos((prev) =>
      prev.map((todo) => {
        if (todo.tags.length === 0 && tagMap.size === 0) {
          return todo;
        }
        const updatedTags = todo.tags
          .filter((tag) => tagMap.has(tag.id))
          .map((tag) => tagMap.get(tag.id) ?? tag);
        return { ...todo, tags: updatedTags };
      })
    );
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const response = await fetch('/api/tags', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load tags');
      }
      const data = (await response.json()) as { tags?: TagWithCounts[] };
      const retrieved = data.tags ?? [];
      setTags(retrieved);
      syncTodosWithTagList(retrieved);
      if (tagFilter != null && !retrieved.some((tag) => tag.id === tagFilter)) {
        setTagFilter(null);
      }
    } catch (error) {
      console.error(error);
    }
  }, [syncTodosWithTagList, tagFilter]);

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

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const filteredTodos = useMemo(() => {
    const byPriority = priorityFilter === 'all' ? todos : todos.filter((todo) => todo.priority === priorityFilter);
    if (tagFilter == null) {
      return byPriority;
    }
    return byPriority.filter((todo) => todo.tags.some((tag) => tag.id === tagFilter));
  }, [todos, priorityFilter, tagFilter]);

  const sections = useMemo(() => groupTodos(filteredTodos), [filteredTodos]);

  const updateCreateForm = (updates: Partial<CreateTodoForm>) => {
    setCreateForm((prev) => ({ ...prev, ...updates }));
  };

  const toggleCreateTagSelection = (tagId: number) => {
    setCreateForm((prev) => {
      const exists = prev.tagIds.includes(tagId);
      const tagIds = exists ? prev.tagIds.filter((id) => id !== tagId) : [...prev.tagIds, tagId];
      return { ...prev, tagIds };
    });
  };

  const handleTagFilterToggle = (tagId: number) => {
    setTagFilter((prev) => (prev === tagId ? null : tagId));
  };

  const handleCreateTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);

    const dueDateIso = toSingaporeIso(createForm.dueDate);
    const selectedTags = tags.filter((tag) => createForm.tagIds.includes(tag.id)).map(stripCounts);
    const payload = {
      title: createForm.title.trim(),
      description: createForm.description.trim(),
      priority: createForm.priority,
      dueDate: dueDateIso,
      isRecurring: createForm.isRecurring,
      recurrencePattern: createForm.isRecurring ? createForm.recurrencePattern : null,
      reminderMinutes: createForm.reminderMinutes ? Number(createForm.reminderMinutes) : null,
      tagIds: createForm.tagIds
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
      lastNotificationSent: null,
      tags: selectedTags,
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
      setCreateForm({ ...INITIAL_FORM });
      await loadTags();
    } catch (error) {
      setTodos((prev) => prev.filter((todo) => todo.id !== optimisticTodo.id));
      setCreateError((error as Error).message);
    }
  };

  const resetTagForm = () => {
    setTagForm({ name: '', color: DEFAULT_TAG_COLOR, description: '' });
    setTagFormError(null);
    setEditingTagId(null);
  };

  const openTagModal = () => {
    resetTagForm();
    setTagDeleteTarget(null);
    setTagModalOpen(true);
  };

  const closeTagModalCompletely = () => {
    setTagModalOpen(false);
    setTagDeleteTarget(null);
    resetTagForm();
  };

  const handleTagInputChange = (updates: Partial<typeof tagForm>) => {
    setTagForm((prev) => ({ ...prev, ...updates }));
  };

  const startEditTag = (tag: TagWithCounts) => {
    setEditingTagId(tag.id);
    setTagForm({ name: tag.name, color: tag.color.toUpperCase(), description: tag.description ?? '' });
    setTagFormError(null);
  };

  const cancelEditTag = () => {
    resetTagForm();
  };

  const handleTagFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTagFormError(null);

    const trimmedName = tagForm.name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 50) {
      setTagFormError('Tag name must be 1-50 characters.');
      return;
    }

    const normalizedColor = tagForm.color.toUpperCase();
    if (!HEX_COLOR_REGEX.test(normalizedColor)) {
      setTagFormError('Color must be a hex value like #3366FF.');
      return;
    }

    const trimmedDescription = tagForm.description.trim();
    if (trimmedDescription.length > 200) {
      setTagFormError('Description must be 200 characters or fewer.');
      return;
    }

    const descriptionValue = trimmedDescription.length === 0 ? null : trimmedDescription;

    setTagSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: trimmedName,
        color: normalizedColor
      };
      if (editingTagId != null || descriptionValue) {
        body.description = descriptionValue;
      }

      const response = await fetch(editingTagId != null ? `/api/tags/${editingTagId}` : '/api/tags', {
        method: editingTagId != null ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to save tag' }));
        throw new Error(data.error ?? 'Failed to save tag');
      }

      await loadTags();
      resetTagForm();
    } catch (error) {
      setTagFormError((error as Error).message);
    } finally {
      setTagSubmitting(false);
    }
  };

  const requestDeleteTag = (tag: TagWithCounts) => {
    setTagDeleteTarget(tag);
    setTagFormError(null);
  };

  const cancelDeleteTag = () => {
    setTagDeleteTarget(null);
  };

  const confirmDeleteTag = async () => {
    if (!tagDeleteTarget) {
      return;
    }

    setTagDeleteLoading(true);
    try {
      const response = await fetch(`/api/tags/${tagDeleteTarget.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to delete tag' }));
        throw new Error(data.error ?? 'Failed to delete tag');
      }

      setTodos((prev) =>
        prev.map((todo) => ({
          ...todo,
          tags: todo.tags.filter((tag) => tag.id !== tagDeleteTarget.id)
        }))
      );

      if (tagFilter === tagDeleteTarget.id) {
        setTagFilter(null);
      }

      setTagDeleteTarget(null);
      await loadTags();
    } catch (error) {
      setTagFormError((error as Error).message);
    } finally {
      setTagDeleteLoading(false);
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

      const data = (await response.json()) as { todo: Todo; nextTodo?: Todo | null };
      setTodos((prev) => {
        const withUpdated = prev.map((item) => (item.id === todo.id ? data.todo : item));
        const nextTodo = data.nextTodo;
        if (!nextTodo) {
          return withUpdated;
        }

        const exists = withUpdated.some((item) => item.id === nextTodo.id);
        if (exists) {
          return withUpdated;
        }

        return [nextTodo, ...withUpdated];
      });
      await loadTags();
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
      await loadTags();
    } catch (error) {
      console.error(error);
      setTodos(current);
    }
  };

  const toggleEditingTagSelection = (tagId: number) => {
    setEditingTagSelection((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const openEdit = (todo: Todo) => {
    setEditing(todo);
    setEditingTagSelection(todo.tags.map((tag) => tag.id));
    setEditErrors(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setEditingTagSelection([]);
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

    const normalizedDueDate = dueDate ? toSingaporeIso(dueDate) : null;
    const reminderMinutes = reminder ? Number(reminder) : null;
    const selectedTagIds = editingTagSelection;
    const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag.id)).map(stripCounts);

    const payload = {
      title,
      description,
      priority,
      dueDate: normalizedDueDate,
      isRecurring,
      recurrencePattern: isRecurring ? recurrencePattern : null,
      reminderMinutes
    };

    setTodos((prev) =>
      prev.map((item) =>
        item.id === editing.id
          ? {
              ...item,
              ...payload,
              tags: selectedTags
            }
          : item
      )
    );

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

      const existingTagIds = editing.tags.map((tag) => tag.id);
      const tagsToAttach = selectedTagIds.filter((id) => !existingTagIds.includes(id));
      const tagsToDetach = existingTagIds.filter((id) => !selectedTagIds.includes(id));

      for (const tagId of tagsToAttach) {
        const attachResponse = await fetch(`/api/todos/${editing.id}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagId })
        });
        if (!attachResponse.ok) {
          const data = await attachResponse.json().catch(() => ({ error: 'Failed to attach tag' }));
          throw new Error(data.error ?? 'Failed to attach tag');
        }
      }

      for (const tagId of tagsToDetach) {
        const detachResponse = await fetch(`/api/todos/${editing.id}/tags`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagId })
        });
        if (!detachResponse.ok) {
          const data = await detachResponse.json().catch(() => ({ error: 'Failed to detach tag' }));
          throw new Error(data.error ?? 'Failed to detach tag');
        }
      }

      const refreshedResponse = await fetch(`/api/todos/${editing.id}`, { cache: 'no-store' });
      if (!refreshedResponse.ok) {
        throw new Error('Failed to refresh todo');
      }
      const refreshedData = (await refreshedResponse.json()) as { todo: Todo };
      setTodos((prev) => prev.map((item) => (item.id === editing.id ? refreshedData.todo : item)));
      await loadTags();
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

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Browser reminders</h2>
            <p className="text-xs text-slate-400">
              Enable notifications to receive alerts before a todo is due.
            </p>
          </div>
          {notificationsSupported ? (
            notificationsEnabled ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
                Enabled
                <span className="text-[10px] font-normal text-emerald-300/80">
                  {notificationsPolling ? 'Polling every 30s' : 'Waiting'}
                </span>
              </span>
            ) : notificationsDenied ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
                Permission denied
              </span>
            ) : (
              <button
                type="button"
                onClick={enableNotifications}
                className="rounded bg-blue-600 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-blue-500"
              >
                Enable notifications
              </button>
            )
          ) : (
            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase text-slate-400">
              Not supported in this browser
            </span>
          )}
        </div>
        {notificationsSupported && notificationsDenied && (
          <p className="mt-2 text-xs text-slate-400">
            Allow notifications in your browser settings to receive reminder alerts.
          </p>
        )}
        {notificationsError && (
          <p className="mt-2 text-xs text-amber-300">{notificationsError}</p>
        )}
      </section>

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

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Tags</span>
              <button
                type="button"
                onClick={openTagModal}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
              >
                Manage tags
              </button>
            </div>
            {tags.length === 0 ? (
              <p className="text-xs text-slate-400">
                No tags yet.{' '}
                <button
                  type="button"
                  onClick={openTagModal}
                  className="font-semibold text-blue-300 hover:text-blue-200"
                >
                  Create one
                </button>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const checked = createForm.tagIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className={`flex items-center gap-2 rounded border px-2 py-1 text-xs transition ${
                        checked ? 'border-blue-500 bg-blue-500/20 text-blue-100' : 'border-slate-700 bg-slate-950/40 text-slate-200 hover:border-blue-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCreateTagSelection(tag.id)}
                        className="accent-blue-500"
                      />
                      <span className="flex items-center gap-1">
                        <span className="h-3 w-3 rounded-full border border-slate-800" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                      </span>
                    </label>
                  );
                })}
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

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-200">Filter by priority</span>
          <div className="flex flex-wrap gap-2">
            {priorityFilterOptions.map((option) => {
              const active = priorityFilter === option;
              const label = option === 'all' ? 'All' : option.toUpperCase();
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPriorityFilter(option)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                    active
                      ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                      : 'border-slate-700 text-slate-300 hover:border-blue-400 hover:text-blue-200'
                  }`}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {priorityFilter !== 'all' && (
          <div className="mt-3 flex items-center gap-3 text-xs uppercase">
            <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 font-semibold text-blue-200">
              Priority: {priorityFilter.toUpperCase()}
            </span>
            <button
              type="button"
              onClick={() => setPriorityFilter('all')}
              className="text-[11px] font-medium text-slate-300 underline hover:text-white"
            >
              Clear
            </button>
          </div>
        )}
        <div className="mt-5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Filter by tag</span>
            <button
              type="button"
              onClick={openTagModal}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
            >
              Manage tags
            </button>
          </div>
          {tags.length === 0 ? (
            <p className="text-xs text-slate-400">No tags to filter yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const active = tagFilter === tag.id;
                const style = getTagBadgeStyle(tag.color);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleTagFilterToggle(tag.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                      active ? 'shadow-[0_0_0_1px_rgba(59,130,246,0.5)]' : 'border-transparent'
                    }`}
                    style={style}
                    aria-pressed={active}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {tagFilter != null && (
          <div className="mt-3 flex items-center gap-3 text-xs uppercase">
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 font-semibold text-emerald-100">
              Tag: {tags.find((tag) => tag.id === tagFilter)?.name ?? 'Unknown'}
            </span>
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              className="text-[11px] font-medium text-slate-300 underline hover:text-white"
            >
              Clear
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-8">
        <TodoSection
          title="Overdue"
          description="Tasks past their due date"
          emptyMessage="Nothing overdue — great job!"
          todos={sections.overdue}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
          onTagClick={handleTagFilterToggle}
          activeTagId={tagFilter}
        />
        <TodoSection
          title="Active"
          description="Upcoming and ongoing tasks"
          emptyMessage="No active todos. Time to add some!"
          todos={sections.active}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
          onTagClick={handleTagFilterToggle}
          activeTagId={tagFilter}
        />
        <TodoSection
          title="Completed"
          description="Finished tasks"
          emptyMessage="No completed todos yet."
          todos={sections.completed}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
          onTagClick={handleTagFilterToggle}
          activeTagId={tagFilter}
        />
      </section>

      {isTagModalOpen && (
        <dialog open className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <header className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Manage Tags</h2>
                <p className="text-xs text-slate-400">Create, edit, and delete tags to organize your todos.</p>
              </div>
              <button
                type="button"
                onClick={closeTagModalCompletely}
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
              >
                Close
              </button>
            </header>

            <form className="mt-4 flex flex-col gap-4" onSubmit={handleTagFormSubmit}>
              <label className="flex flex-col gap-2 text-sm">
                Tag name
                <input
                  value={tagForm.name}
                  onChange={(event) => handleTagInputChange({ name: event.target.value })}
                  maxLength={50}
                  required
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Color
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={tagForm.color}
                    onChange={(event) => handleTagInputChange({ color: event.target.value.toUpperCase() })}
                    className="h-10 w-14 cursor-pointer border border-slate-700 bg-slate-950"
                  />
                  <input
                    value={tagForm.color}
                    onChange={(event) => handleTagInputChange({ color: event.target.value.toUpperCase() })}
                    maxLength={7}
                    className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    placeholder="#3B82F6"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Description <span className="text-xs text-slate-500">Optional</span>
                <textarea
                  value={tagForm.description}
                  onChange={(event) => handleTagInputChange({ description: event.target.value })}
                  maxLength={200}
                  className="min-h-[70px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              {tagFormError && <p className="text-sm text-red-400">{tagFormError}</p>}
              <div className="flex items-center justify-between">
                {editingTagId != null ? (
                  <button
                    type="button"
                    onClick={cancelEditTag}
                    className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
                  >
                    Cancel editing
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">Tag names must be unique per user.</span>
                )}
                <button
                  type="submit"
                  disabled={tagSubmitting}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-800"
                >
                  {editingTagId != null ? 'Save changes' : 'Create tag'}
                </button>
              </div>
            </form>

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-200">Existing tags</h3>
              {tags.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No tags yet. Create your first tag above.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {tags.map((tag) => (
                    <li
                      key={tag.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700 bg-slate-950/50 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="h-4 w-4 rounded-full border border-slate-800" style={{ backgroundColor: tag.color }} />
                        <div>
                          <p className="text-sm font-medium text-slate-100">{tag.name}</p>
                          <p className="text-xs text-slate-400">
                            {tag.todoCount} todo{tag.todoCount === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEditTag(tag)}
                          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteTag(tag)}
                          className="rounded border border-red-600 px-2 py-1 text-xs text-red-200 hover:border-red-500/80"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {tagDeleteTarget && (
              <div className="mt-6 rounded border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p>
                  Delete tag <strong>{tagDeleteTarget.name}</strong>? This will remove it from {tagDeleteTarget.todoCount}{' '}
                  associated todo{tagDeleteTarget.todoCount === 1 ? '' : 's'}.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelDeleteTag}
                    className="rounded border border-amber-500 px-3 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteTag}
                    disabled={tagDeleteLoading}
                    className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900"
                  >
                    Delete tag
                  </button>
                </div>
              </div>
            )}
          </div>
        </dialog>
      )}

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
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>Tags</span>
                  <button
                    type="button"
                    onClick={openTagModal}
                    className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-blue-500 hover:text-blue-200"
                  >
                    Manage tags
                  </button>
                </div>
                {tags.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No tags available.{' '}
                    <button
                      type="button"
                      onClick={openTagModal}
                      className="font-semibold text-blue-300 hover:text-blue-200"
                    >
                      Create one
                    </button>
                    .
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const checked = editingTagSelection.includes(tag.id);
                      return (
                        <label
                          key={tag.id}
                          className={`flex items-center gap-2 rounded border px-2 py-1 text-xs transition ${
                            checked
                              ? 'border-blue-500 bg-blue-500/20 text-blue-100'
                              : 'border-slate-700 bg-slate-950/40 text-slate-200 hover:border-blue-500'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEditingTagSelection(tag.id)}
                            className="accent-blue-500"
                          />
                          <span className="flex items-center gap-1">
                            <span className="h-3 w-3 rounded-full border border-slate-800" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
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
  onTagClick: (tagId: number) => void;
  activeTagId: number | null;
}

function TodoSection({
  title,
  description,
  emptyMessage,
  todos,
  onToggle,
  onEdit,
  onDelete,
  onTagClick,
  activeTagId
}: TodoSectionProps) {
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
                      <PriorityBadge priority={todo.priority} />
                      <span>{todo.dueDate ? `Due ${formatSingaporeDate(todo.dueDate)}` : 'No due date'}</span>
                      {todo.isRecurring && todo.recurrencePattern && (
                        <span className="rounded border border-blue-500/40 px-2 py-1 text-blue-300">
                          Repeats {todo.recurrencePattern.toUpperCase()}
                        </span>
                      )}
                      {todo.reminderMinutes != null && <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">Reminder {todo.reminderMinutes}m</span>}
                    </div>
                    {todo.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {todo.tags.map((tag) => {
                          const active = activeTagId === tag.id;
                          const style = getTagBadgeStyle(tag.color);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => onTagClick(tag.id)}
                              className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
                                active ? 'shadow-[0_0_0_1px_rgba(52,211,153,0.5)]' : 'border-transparent'
                              }`}
                              style={style}
                              aria-pressed={active}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
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

function PriorityBadge({ priority }: { priority: Priority }) {
  const style = getPriorityBadgeStyle(priority);
  return (
    <span
      className="rounded border px-2 py-1 text-xs font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: style.background,
        borderColor: style.border,
        color: style.text
      }}
    >
      {priority.toUpperCase()}
    </span>
  );
}

function getPriorityBadgeStyle(priority: Priority) {
  return PRIORITY_BADGE_STYLES[priority];
}
