'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { DateTime } from 'luxon';
import type { Priority, RecurrencePattern, Subtask, Tag, Todo } from '@/lib/db';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';

const priorityOptions: Priority[] = ['high', 'medium', 'low'];
const priorityLabels: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};
const priorityBadgeClasses: Record<Priority, string> = {
  high: 'bg-red-500 text-white dark:bg-red-400 dark:text-slate-900',
  medium: 'bg-amber-500 text-slate-900 dark:bg-amber-300 dark:text-slate-900',
  low: 'bg-blue-500 text-white dark:bg-blue-400 dark:text-slate-900'
};
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
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

type PriorityFilter = 'all' | Priority;

type CompletionFilter = 'all' | 'completed' | 'incomplete';

interface FilterState {
  search: string;
  priority: PriorityFilter;
  tagId: number | 'all';
  completion: CompletionFilter;
  dueFrom: string;
  dueTo: string;
}

interface FilterPreset {
  id: string;
  name: string;
  state: FilterState;
}

type ClientTodo = Todo & { subtasks: Subtask[]; tagIds: number[] };

const DEFAULT_FILTERS: FilterState = {
  search: '',
  priority: 'all',
  tagId: 'all',
  completion: 'all',
  dueFrom: '',
  dueTo: ''
};

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function parseFilenameFromDisposition(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }

  const asciiMatch = value.match(/filename="?([^";]+)"?/i);
  if (asciiMatch && asciiMatch[1]) {
    return asciiMatch[1];
  }

  return null;
}

function createDefaultFilters(): FilterState {
  return { ...DEFAULT_FILTERS };
}

function areFiltersActive(filters: FilterState): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.priority !== 'all' ||
    filters.tagId !== 'all' ||
    filters.completion !== 'all' ||
    filters.dueFrom !== '' ||
    filters.dueTo !== ''
  );
}

function normalizeFilterState(state?: Partial<FilterState>): FilterState {
  if (!state) {
    return createDefaultFilters();
  }

  const priorityValue = state.priority;
  const completionValue = state.completion;
  const tagValue = state.tagId;

  return {
    search: typeof state.search === 'string' ? state.search : '',
    priority:
      priorityValue === 'all' || isPriorityValue(priorityValue)
        ? (priorityValue ?? 'all')
        : 'all',
    tagId: typeof tagValue === 'number' && Number.isFinite(tagValue) ? tagValue : 'all',
    completion:
      completionValue === 'completed' || completionValue === 'incomplete'
        ? completionValue
        : 'all',
    dueFrom: typeof state.dueFrom === 'string' ? state.dueFrom : '',
    dueTo: typeof state.dueTo === 'string' ? state.dueTo : ''
  };
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

function normalizePriority(priority: unknown): Priority {
  return priority === 'high' || priority === 'medium' || priority === 'low' ? priority : 'medium';
}

function normalizeTodoPriority<T extends Todo>(todo: T): T {
  return {
    ...todo,
    priority: normalizePriority(todo.priority)
  };
}

function isPriorityValue(value: unknown): value is Priority {
  return value === 'high' || value === 'medium' || value === 'low';
}

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

function groupTodos<T extends Todo>(todos: T[]) {
  const now = getSingaporeNow();
  const overdue: T[] = [];
  const active: T[] = [];
  const completed: T[] = [];

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

    const createdA = DateTime.fromISO(a.createdAt).toMillis();
    const createdB = DateTime.fromISO(b.createdAt).toMillis();

    if (!a.dueDate && !b.dueDate) {
      return createdA - createdB;
    }

    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;

    const dueA = DateTime.fromISO(a.dueDate).setZone('Asia/Singapore');
    const dueB = DateTime.fromISO(b.dueDate).setZone('Asia/Singapore');
    const dueDiff = dueA.toMillis() - dueB.toMillis();
    if (dueDiff !== 0) {
      return dueDiff;
    }

    return createdA - createdB;
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
  const [todos, setTodos] = useState<ClientTodo[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [uiState, setUiState] = useState<UiState>({ loading: true, error: null });
  const [createForm, setCreateForm] = useState<CreateTodoForm>(INITIAL_FORM);
  const [editing, setEditing] = useState<ClientTodo | null>(null);
  const [editErrors, setEditErrors] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => createDefaultFilters());
  const [searchValue, setSearchValue] = useState('');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [presetsAvailable, setPresetsAvailable] = useState(true);
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const skipPresetClearRef = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const updateFiltersPartial = useCallback((updates: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
    setActivePresetId(null);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(createDefaultFilters());
    setSearchValue('');
    setActivePresetId(null);
  }, []);

  const applyPresetState = useCallback((preset: FilterPreset) => {
    const normalized = normalizeFilterState(preset.state);
    skipPresetClearRef.current = true;
    setFilters(() => ({ ...normalized }));
    setSearchValue(normalized.search);
    setActivePresetId(preset.id);
    if (normalized.completion !== 'all' || normalized.dueFrom !== '' || normalized.dueTo !== '') {
      setIsAdvancedOpen(true);
    }
  }, []);

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      setFilterPresets((prev) => prev.filter((preset) => preset.id !== presetId));
      if (activePresetId === presetId) {
        setActivePresetId(null);
      }
    },
    [activePresetId]
  );

  const handleOpenSavePreset = useCallback(() => {
    setPresetError(null);
    setNewPresetName('');
    setShowSavePresetModal(true);
  }, []);

  const handleSavePreset = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!presetsAvailable) {
        setPresetError('Filter presets are unavailable in this browser.');
        return;
      }

      const trimmed = newPresetName.trim();
      if (!trimmed) {
        setPresetError('Preset name is required');
        return;
      }

      if (filterPresets.some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
        setPresetError('Preset name must be unique');
        return;
      }

      const state = normalizeFilterState({ ...filters, search: searchValue });
      const preset: FilterPreset = {
        id:
          typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
            ? globalThis.crypto.randomUUID()
            : `preset-${Date.now()}`,
        name: trimmed,
        state
      };

      setFilterPresets((prev) => [...prev, preset]);
      skipPresetClearRef.current = true;
      setFilters(() => ({ ...state }));
      setSearchValue(state.search);
      setActivePresetId(preset.id);
      setShowSavePresetModal(false);
      setNewPresetName('');
      setPresetError(null);
    },
    [filterPresets, filters, newPresetName, presetsAvailable, searchValue]
  );

  const filtersActive = useMemo(() => areFiltersActive({ ...filters, search: searchValue }), [filters, searchValue]);
  const advancedFiltersActive = filters.completion !== 'all' || filters.dueFrom !== '' || filters.dueTo !== '';
  const tagMap = useMemo(() => {
    const map = new Map<number, Tag>();
    for (const tag of tags) {
      map.set(tag.id, tag);
    }
    return map;
  }, [tags]);

  const loadTodos = useCallback(async () => {
    setUiState((prev) => ({ ...prev, loading: true }));
    try {
      const response = await fetch('/api/todos', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load todos');
      }
      const data = (await response.json()) as {
        todos?: ClientTodo[];
        tags?: Tag[];
        userId?: number;
      };
      const fetched = Array.isArray(data.todos) ? data.todos : [];
      setTodos(fetched.map((todo) => normalizeTodoPriority(todo)));
      setTags(Array.isArray(data.tags) ? data.tags : []);
      const resolvedUserId = typeof data.userId === 'number' ? data.userId : fetched[0]?.userId ?? null;
      setCurrentUserId(resolvedUserId ?? null);
      setUiState({ loading: false, error: null });
    } catch (error) {
      setUiState({ loading: false, error: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/todos/export');
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to export todos');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const filename = parseFilenameFromDisposition(response.headers.get('Content-Disposition')) ?? 'todos-export.json';

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setBanner({ type: 'success', text: 'Export completed successfully.' });
    } catch (error) {
      setBanner({ type: 'error', text: (error as Error).message ?? 'Failed to export todos' });
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      if (file.size > MAX_IMPORT_BYTES) {
        setBanner({ type: 'error', text: 'Import file exceeds 5 MB limit.' });
        event.target.value = '';
        return;
      }

      setIsImporting(true);

      try {
        const fileContents = await file.text();

        try {
          JSON.parse(fileContents);
        } catch (error) {
          throw new Error('Selected file is not valid JSON.');
        }

        const response = await fetch('/api/todos/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: fileContents
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Failed to import todos');
        }

        const result = (await response.json()) as {
          importedTodos?: number;
          importedSubtasks?: number;
          importedTags?: number;
          reusedTags?: number;
        };

        setBanner({
          type: 'success',
          text: `Imported ${result.importedTodos ?? 0} todos and ${result.importedSubtasks ?? 0} subtasks (${result.importedTags ?? 0} tags created, ${result.reusedTags ?? 0} reused).`
        });

        await loadTodos();
      } catch (error) {
        setBanner({ type: 'error', text: (error as Error).message ?? 'Failed to import todos' });
      } finally {
        setIsImporting(false);
        event.target.value = '';
      }
    },
    [loadTodos]
  );

  const presetStorageKey = useMemo(
    () => (currentUserId != null ? `todo-filter-presets-${currentUserId}` : 'todo-filter-presets-guest'),
    [currentUserId]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(presetStorageKey);
      if (!raw) {
        setFilterPresets([]);
        setPresetsAvailable(true);
        return;
      }

      const parsed = JSON.parse(raw) as FilterPreset[] | undefined;
      if (Array.isArray(parsed)) {
        setFilterPresets(parsed.map((preset) => ({ ...preset, state: normalizeFilterState(preset.state) })));
      } else {
        setFilterPresets([]);
      }
      setPresetsAvailable(true);
    } catch (error) {
      console.warn('Failed to read filter presets from localStorage', error);
      setPresetsAvailable(false);
      setFilterPresets([]);
    }
  }, [presetStorageKey]);

  useEffect(() => {
    if (!presetsAvailable || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(presetStorageKey, JSON.stringify(filterPresets));
    } catch (error) {
      console.warn('Failed to persist filter presets', error);
      setPresetsAvailable(false);
    }
  }, [filterPresets, presetStorageKey, presetsAvailable]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      let changed = false;
      setFilters((prev) => {
        if (prev.search === searchValue) {
          return prev;
        }
        changed = true;
        return { ...prev, search: searchValue };
      });

      if (!changed) {
        return;
      }

      if (skipPresetClearRef.current) {
        skipPresetClearRef.current = false;
      } else {
        setActivePresetId(null);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [searchValue]);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  const filteredTodos = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    const hasTerm = term.length > 0;

    const fromDate = filters.dueFrom
      ? DateTime.fromISO(filters.dueFrom, { zone: 'Asia/Singapore' }).startOf('day')
      : null;
    const toDate = filters.dueTo
      ? DateTime.fromISO(filters.dueTo, { zone: 'Asia/Singapore' }).endOf('day')
      : null;

    return todos.filter((todo) => {
      if (hasTerm) {
        const inTitle = todo.title.toLowerCase().includes(term);
        const inDescription = todo.description?.toLowerCase().includes(term) ?? false;
        const inSubtasks = todo.subtasks.some((subtask) => subtask.title.toLowerCase().includes(term));
        if (!inTitle && !inDescription && !inSubtasks) {
          return false;
        }
      }

      if (filters.priority !== 'all' && todo.priority !== filters.priority) {
        return false;
      }

      if (filters.tagId !== 'all' && !todo.tagIds.includes(filters.tagId)) {
        return false;
      }

      if (filters.completion === 'completed' && !todo.isCompleted) {
        return false;
      }

      if (filters.completion === 'incomplete' && todo.isCompleted) {
        return false;
      }

      if (fromDate || toDate) {
        if (!todo.dueDate) {
          return false;
        }
        const due = DateTime.fromISO(todo.dueDate).setZone('Asia/Singapore');
        if (!due.isValid) {
          return false;
        }
        if (fromDate && due < fromDate) {
          return false;
        }
        if (toDate && due > toDate) {
          return false;
        }
      }

      return true;
    });
  }, [todos, filters]);

  const sections = useMemo(() => groupTodos(filteredTodos), [filteredTodos]);

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

    const optimisticTodo: ClientTodo = {
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
      updatedAt: optimisticTimestamp,
      subtasks: [],
      tagIds: []
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

      const data = (await response.json()) as { todo: ClientTodo; tags?: Tag[] };
      if (Array.isArray(data.tags)) {
        setTags(data.tags);
      }
      setTodos((prev) => [
        normalizeTodoPriority(data.todo),
        ...prev.filter((todo) => todo.id !== optimisticTodo.id)
      ]);
      setCreateForm(INITIAL_FORM);
    } catch (error) {
      setTodos((prev) => prev.filter((todo) => todo.id !== optimisticTodo.id));
      setCreateError((error as Error).message);
    }
  };

  const handleToggle = async (todo: ClientTodo) => {
    const updated: ClientTodo = {
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

      const data = (await response.json()) as { todo: ClientTodo; nextTodo?: ClientTodo; tags?: Tag[] };
      if (Array.isArray(data.tags)) {
        setTags(data.tags);
      }
      setTodos((prev) => {
        const normalizedCurrent = normalizeTodoPriority(data.todo);
        let nextState = prev.map((item) => (item.id === todo.id ? normalizedCurrent : item));

        if (data.nextTodo) {
          const normalizedNext = normalizeTodoPriority(data.nextTodo);
          const exists = nextState.some((item) => item.id === normalizedNext.id);
          if (exists) {
            nextState = nextState.map((item) => (item.id === normalizedNext.id ? normalizedNext : item));
          } else {
            nextState = [...nextState, normalizedNext];
          }
        }

        return nextState;
      });
    } catch (error) {
      setTodos((prev) => prev.map((item) => (item.id === todo.id ? todo : item)));
      console.error(error);
    }
  };

  const handleDelete = async (todo: ClientTodo) => {
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

  const openEdit = (todo: ClientTodo) => {
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
    const priorityValue = formData.get('priority');
    if (!isPriorityValue(priorityValue)) {
      setEditErrors('Invalid priority selection');
      return;
    }
    const priority = priorityValue;
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

  const data = (await response.json()) as { todo: ClientTodo };
  setTodos((prev) => prev.map((item) => (item.id === editing.id ? normalizeTodoPriority(data.todo) : item)));
      closeEdit();
    } catch (error) {
      setEditErrors((error as Error).message);
      loadTodos();
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Todo Dashboard</h1>
          <p className="text-sm text-slate-300">All times in Singapore timezone (Asia/Singapore).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-100 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? 'Exporting...' : 'Export JSON'}
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            disabled={isImporting}
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-100 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isImporting ? 'Importing...' : 'Import JSON'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </header>

      {banner && (
        <div
          className={`flex items-start justify-between gap-4 rounded border px-4 py-3 text-sm shadow ${
            banner.type === 'success'
              ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
              : 'border-red-500/60 bg-red-500/10 text-red-100'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="rounded px-2 py-1 text-xs text-slate-200 hover:bg-slate-200/10"
            aria-label="Dismiss notification"
          >
            Close
          </button>
        </div>
      )}

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
                onChange={(event) => updateCreateForm({ priority: normalizePriority(event.target.value) })}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              >
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {priorityLabels[option]}
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

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow">
        <h2 className="text-xl font-semibold">Search &amp; Filters</h2>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="filter-search">
              Search
            </label>
            <div className="relative">
              <input
                id="filter-search"
                type="search"
                value={searchValue}
                onChange={(event) => {
                  setSearchValue(event.target.value);
                  if (activePresetId) {
                    setActivePresetId(null);
                  }
                }}
                placeholder="Search todos and subtasks..."
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 pr-10 text-slate-100"
                aria-label="Search todos and subtasks"
              />
              {searchValue && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => setSearchValue('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="filter-priority">
                Priority
              </label>
              <select
                id="filter-priority"
                value={filters.priority}
                onChange={(event) => updateFiltersPartial({
                  priority: event.target.value === 'all' ? 'all' : normalizePriority(event.target.value)
                })}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              >
                <option value="all">All priorities</option>
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {priorityLabels[option]}
                  </option>
                ))}
              </select>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-1 flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="filter-tag">
                  Tag
                </label>
                <select
                  id="filter-tag"
                  value={filters.tagId}
                  onChange={(event) => updateFiltersPartial({
                    tagId: event.target.value === 'all' ? 'all' : Number.parseInt(event.target.value, 10) || 'all'
                  })}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  <option value="all">All tags</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-3 md:ml-auto">
              <button
                type="button"
                onClick={() => setIsAdvancedOpen((prev) => !prev)}
                className={`rounded border px-4 py-2 text-sm transition-colors ${
                  isAdvancedOpen || advancedFiltersActive
                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                    : 'border-slate-700 text-slate-200 hover:border-slate-500'
                }`}
                aria-expanded={isAdvancedOpen}
                aria-controls="advanced-filters"
              >
                {isAdvancedOpen ? '▼ Advanced' : '▶ Advanced'}
              </button>
            </div>
          </div>

          {filtersActive && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded border border-red-500 px-4 py-2 text-sm text-red-200 transition-colors hover:bg-red-500/10"
                onClick={handleClearFilters}
              >
                Clear All
              </button>
              {presetsAvailable ? (
                <button
                  type="button"
                  className="rounded border border-emerald-500 px-4 py-2 text-sm text-emerald-200 transition-colors hover:bg-emerald-500/10"
                  onClick={handleOpenSavePreset}
                >
                  Save Filter
                </button>
              ) : (
                <span className="text-xs text-slate-400">Filter presets unavailable (private browsing mode).</span>
              )}
            </div>
          )}

          {isAdvancedOpen && (
            <div
              id="advanced-filters"
              className="flex flex-col gap-4 rounded border border-slate-800 bg-slate-950/40 p-4"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex flex-1 flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="filter-completion">
                    Completion
                  </label>
                  <select
                    id="filter-completion"
                    value={filters.completion}
                    onChange={(event) => updateFiltersPartial({
                      completion: event.target.value as CompletionFilter
                    })}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  >
                    <option value="all">All todos</option>
                    <option value="incomplete">Incomplete only</option>
                    <option value="completed">Completed only</option>
                  </select>
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="filter-due-from">
                    Due from
                  </label>
                  <input
                    id="filter-due-from"
                    type="date"
                    value={filters.dueFrom}
                    onChange={(event) => updateFiltersPartial({ dueFrom: event.target.value })}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="filter-due-to">
                    Due to
                  </label>
                  <input
                    id="filter-due-to"
                    type="date"
                    value={filters.dueTo}
                    onChange={(event) => updateFiltersPartial({ dueTo: event.target.value })}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              {filterPresets.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-slate-500">Saved presets</span>
                  {filterPresets.map((preset) => (
                    <div
                      key={preset.id}
                      className={`flex items-center gap-1 rounded border px-3 py-1 text-xs transition-colors ${
                        activePresetId === preset.id
                          ? 'border-emerald-500 text-emerald-200'
                          : 'border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <button
                        type="button"
                        className="font-medium"
                        onClick={() => applyPresetState(preset)}
                      >
                        {preset.name}
                      </button>
                      <button
                        type="button"
                        className="rounded px-1 text-slate-500 hover:text-red-400"
                        onClick={() => handleDeletePreset(preset.id)}
                        aria-label={`Delete preset ${preset.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {uiState.loading && <p>Loading todos…</p>}
      {uiState.error && <p className="text-sm text-red-400">{uiState.error}</p>}

      <section className="flex flex-col gap-8">
        <TodoSection
          title="Overdue"
          description="Tasks past their due date"
          emptyMessage="Nothing overdue — great job!"
          todos={sections.overdue}
          tagMap={tagMap}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
        <TodoSection
          title="Active"
          description="Upcoming and ongoing tasks"
          emptyMessage="No active todos. Time to add some!"
          todos={sections.active}
          tagMap={tagMap}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
        <TodoSection
          title="Completed"
          description="Finished tasks"
          emptyMessage="No completed todos yet."
          todos={sections.completed}
          tagMap={tagMap}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </section>

      {showSavePresetModal && (
        <dialog open className="fixed inset-0 flex items-center justify-center bg-black/60">
          <form
            className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
            onSubmit={handleSavePreset}
          >
            <h2 className="text-xl font-semibold">Save Filter Preset</h2>
            <p className="mt-2 text-sm text-slate-400">Name this filter combination to reuse it later.</p>
            <div className="mt-4 flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="preset-name">
                Preset name
              </label>
              <input
                id="preset-name"
                value={newPresetName}
                onChange={(event) => setNewPresetName(event.target.value)}
                maxLength={60}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                placeholder="This Week — High Priority"
                required
              />
            </div>
            {presetError && <p className="mt-2 text-sm text-red-400">{presetError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="rounded border border-slate-700 px-4 py-2 text-sm"
                onClick={() => {
                  setShowSavePresetModal(false);
                  setPresetError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!presetsAvailable}
              >
                Save Preset
              </button>
            </div>
          </form>
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
                      {priorityLabels[option]}
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
  todos: ClientTodo[];
  tagMap: Map<number, Tag>;
  onToggle: (todo: ClientTodo) => void;
  onEdit: (todo: ClientTodo) => void;
  onDelete: (todo: ClientTodo) => void;
}

function TodoSection({ title, description, emptyMessage, todos, tagMap, onToggle, onEdit, onDelete }: TodoSectionProps) {
  const sectionSlug = toTestIdSegment(title);
  return (
    <section
      className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow"
      data-testid={`todo-section-${sectionSlug}`}
    >
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
        <ul className="mt-6 flex flex-col gap-3" data-testid={`${sectionSlug}-list`}>
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="rounded border border-slate-800 bg-slate-950/60 p-4"
              data-testid="todo-item"
              data-priority={todo.priority}
            >
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
                      {todo.isRecurring && todo.recurrencePattern && <span className="rounded border border-blue-500/40 px-2 py-1 text-blue-300">Repeats {todo.recurrencePattern}</span>}
                      {todo.reminderMinutes != null && <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">Reminder {todo.reminderMinutes}m</span>}
                      {todo.tagIds.length > 0 &&
                        todo.tagIds.map((tagId) => {
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
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide ${priorityBadgeClasses[priority]}`}
      aria-label={`${priorityLabels[priority]} priority`}
      data-testid={`priority-badge-${priority}`}
    >
      <span aria-hidden="true">{priorityLabels[priority]}</span>
    </span>
  );
}

function toTestIdSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
