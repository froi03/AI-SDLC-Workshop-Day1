'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { DateTime } from 'luxon';
import type {
  Priority,
  ProgressStats,
  RecurrencePattern,
  Subtask,
  Tag,
  TagWithCounts,
  Template,
  TemplateSubtaskDefinition,
  Todo
} from '@/lib/db';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { filterTodos } from '@/lib/filterTodos';
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

interface TemplateFormState {
  name: string;
  description: string;
  category: string;
  todoTitle: string;
  todoDescription: string;
  dueOffsetDays: string;
  priority: Priority;
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern;
  reminderMinutes: string;
  tagIds: number[];
}

const INITIAL_TEMPLATE_FORM: TemplateFormState = {
  name: '',
  description: '',
  category: '',
  todoTitle: '',
  todoDescription: '',
  dueOffsetDays: '0',
  priority: 'medium',
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

function sortSubtasks(subtasks: Subtask[]): Subtask[] {
  return [...subtasks].sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.id - b.id;
  });
}

function singaporeNowUtcIso(): string {
  const iso = getSingaporeNow().toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to derive Singapore timestamp');
  }
  return iso;
}

function buildTemplateFormFromTodo(todo: Todo): {
  form: TemplateFormState;
  subtasks: TemplateSubtaskDefinition[];
} {
  let dueOffsetDays = '0';
  if (todo.dueDate) {
    const due = DateTime.fromISO(todo.dueDate).setZone('Asia/Singapore');
    if (due.isValid) {
      const diff = Math.max(0, Math.round(due.startOf('day').diff(getSingaporeNow().startOf('day'), 'days').days));
      dueOffsetDays = String(diff);
    }
  }

  const form: TemplateFormState = {
    name: todo.title,
    description: '',
    category: '',
    todoTitle: todo.title,
    todoDescription: todo.description,
    dueOffsetDays,
    priority: todo.priority,
    isRecurring: todo.isRecurring,
    recurrencePattern: todo.recurrencePattern ?? 'daily',
    reminderMinutes: todo.reminderMinutes != null ? String(todo.reminderMinutes) : '',
    tagIds: todo.tags.map((tag) => tag.id)
  };

  const subtasks = todo.subtasks
    .map<TemplateSubtaskDefinition>((subtask) => ({ title: subtask.title, position: subtask.position }))
    .sort((a, b) => a.position - b.position);

  return { form, subtasks };
}

function buildTemplateFormFromTemplate(template: Template): {
  form: TemplateFormState;
  subtasks: TemplateSubtaskDefinition[];
} {
  const form: TemplateFormState = {
    name: template.name,
    description: template.description ?? '',
    category: template.category ?? '',
    todoTitle: template.todoTitle,
    todoDescription: template.todoDescription,
    dueOffsetDays: String(template.dueOffsetDays),
    priority: template.priority,
    isRecurring: template.recurrencePattern != null,
    recurrencePattern: template.recurrencePattern ?? 'daily',
    reminderMinutes: template.reminderMinutes != null ? String(template.reminderMinutes) : '',
    tagIds: [...template.tagIds]
  };

  const subtasks = [...template.subtasks].sort((a, b) => a.position - b.position);

  return { form, subtasks };
}

export default function TodoPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [uiState, setUiState] = useState<UiState>({ loading: true, error: null });
  const [createForm, setCreateForm] = useState<CreateTodoForm>({ ...INITIAL_FORM });
  const [editing, setEditing] = useState<Todo | null>(null);
  const [editErrors, setEditErrors] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedPriority, setSelectedPriority] = useState<PriorityFilter>('all');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tags, setTags] = useState<TagWithCounts[]>([]);
  const [isTagModalOpen, setTagModalOpen] = useState(false);
  const [tagForm, setTagForm] = useState({ name: '', color: DEFAULT_TAG_COLOR, description: '' });
  const [tagFormError, setTagFormError] = useState<string | null>(null);
  const [tagSubmitting, setTagSubmitting] = useState(false);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [tagDeleteTarget, setTagDeleteTarget] = useState<TagWithCounts | null>(null);
  const [tagDeleteLoading, setTagDeleteLoading] = useState(false);
  const [editingTagSelection, setEditingTagSelection] = useState<number[]>([]);
  const [subtaskInputs, setSubtaskInputs] = useState<Record<number, string>>({});
  const [subtaskErrors, setSubtaskErrors] = useState<Record<number, string | null>>({});
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [subtaskEditDrafts, setSubtaskEditDrafts] = useState<Record<number, string>>({});
  const [creatingSubtaskTodoIds, setCreatingSubtaskTodoIds] = useState<number[]>([]);
  const [updatingSubtaskIds, setUpdatingSubtaskIds] = useState<number[]>([]);
  const [expandedTodoIds, setExpandedTodoIds] = useState<number[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [isTemplateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalMode, setTemplateModalMode] = useState<'create' | 'edit'>('create');
  const [templateSourceTodo, setTemplateSourceTodo] = useState<Todo | null>(null);
  const [templateEditTarget, setTemplateEditTarget] = useState<Template | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>({ ...INITIAL_TEMPLATE_FORM });
  const [templateSubtasksPreview, setTemplateSubtasksPreview] = useState<TemplateSubtaskDefinition[]>([]);
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);
  const [isTemplateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateManagerError, setTemplateManagerError] = useState<string | null>(null);
  const [isTemplateUseModalOpen, setTemplateUseModalOpen] = useState(false);
  const [templateUseTargetId, setTemplateUseTargetId] = useState<number | null>(null);
  const [templateUseDueDate, setTemplateUseDueDate] = useState('');
  const [templateUseOffset, setTemplateUseOffset] = useState('');
  const [templateUseError, setTemplateUseError] = useState<string | null>(null);
  const [templateUseSubmitting, setTemplateUseSubmitting] = useState(false);
  const [templateMissingTags, setTemplateMissingTags] = useState<number[]>([]);
  const [templateDeleteTarget, setTemplateDeleteTarget] = useState<Template | null>(null);
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
      setSelectedTagIds((prev) => prev.filter((id) => retrieved.some((tag) => tag.id === id)));
    } catch (error) {
      console.error(error);
    }
  }, [syncTodosWithTagList]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const response = await fetch('/api/templates', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load templates');
      }
      const data = (await response.json()) as { templates?: Template[] };
      setTemplates(data.templates ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const loadTodos = useCallback(async () => {
    setUiState((prev) => ({ ...prev, loading: true }));
    try {
      const response = await fetch('/api/todos', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load todos');
      }
      const data = await response.json();
      const retrieved = (data.todos ?? []) as Todo[];
      setTodos(retrieved);
      setExpandedTodoIds((prev) => {
        const next = new Set(prev);
        for (const todo of retrieved) {
          if (todo.subtasks.length > 0) {
            next.add(todo.id);
          }
        }
        return Array.from(next);
      });
      setSubtaskInputs({});
      setSubtaskErrors({});
      setEditingSubtaskId(null);
      setSubtaskEditDrafts({});
      setCreatingSubtaskTodoIds([]);
      setUpdatingSubtaskIds([]);
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

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filteredTodos = useMemo(() => {
    const priority = selectedPriority === 'all' ? null : selectedPriority;
    return filterTodos(todos, {
      query: debouncedSearchQuery,
      priority,
      tagIds: selectedTagIds
    });
  }, [todos, debouncedSearchQuery, selectedPriority, selectedTagIds]);

  const searchQueryDisplay = searchInput.trim();
  const hasSearchFilter = searchQueryDisplay.length > 0;
  const hasPriorityFilter = selectedPriority !== 'all';
  const hasTagFilters = selectedTagIds.length > 0;
  const hasActiveFilters = hasSearchFilter || hasPriorityFilter || hasTagFilters;

  const sections = useMemo(() => groupTodos(filteredTodos), [filteredTodos]);

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) {
      return templates;
    }
    return templates.filter((template) => {
      return (
        template.name.toLowerCase().includes(query) ||
        (template.category ?? '').toLowerCase().includes(query)
      );
    });
  }, [templates, templateSearch]);

  const templatesByCategory = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const template of filteredTemplates) {
      const key = (template.category ?? '').trim().length > 0 ? template.category!.trim() : 'General';
      const existing = map.get(key);
      if (existing) {
        existing.push(template);
      } else {
        map.set(key, [template]);
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTemplates]);

  const selectedTemplateForUse = useMemo(
    () => templates.find((template) => template.id === templateUseTargetId) ?? null,
    [templates, templateUseTargetId]
  );

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

  const handleTagToggle = (tagId: number) => {
    setSelectedTagIds((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const clearSearchFilter = () => {
    setSearchInput('');
    setDebouncedSearchQuery('');
  };

  const clearPriorityFilter = () => {
    setSelectedPriority('all');
  };

  const clearTagFilters = () => {
    setSelectedTagIds([]);
  };

  const clearAllFilters = () => {
    clearSearchFilter();
    clearPriorityFilter();
    clearTagFilters();
  };

  const resetTemplateModalState = () => {
    setTemplateModalOpen(false);
    setTemplateModalMode('create');
    setTemplateSourceTodo(null);
    setTemplateEditTarget(null);
    setTemplateForm({ ...INITIAL_TEMPLATE_FORM });
    setTemplateSubtasksPreview([]);
    setTemplateFormError(null);
    setTemplateSubmitting(false);
  };

  const openSaveTemplateModal = (todo: Todo) => {
    const { form, subtasks } = buildTemplateFormFromTodo(todo);
    const validTagIds = form.tagIds.filter((id) => tags.some((tag) => tag.id === id));
    setTemplateForm({ ...form, tagIds: validTagIds });
    setTemplateSubtasksPreview(subtasks);
    setTemplateSourceTodo(todo);
    setTemplateEditTarget(null);
    setTemplateModalMode('create');
    setTemplateFormError(null);
    setTemplateSubmitting(false);
    setTemplateModalOpen(true);
  };

  const openEditTemplateModal = (template: Template) => {
    const { form, subtasks } = buildTemplateFormFromTemplate(template);
    const validTagIds = form.tagIds.filter((id) => tags.some((tag) => tag.id === id));
    setTemplateForm({ ...form, tagIds: validTagIds });
    setTemplateSubtasksPreview(subtasks);
    setTemplateSourceTodo(null);
    setTemplateEditTarget(template);
    setTemplateModalMode('edit');
    setTemplateFormError(null);
    setTemplateSubmitting(false);
    setTemplateModalOpen(true);
  };

  const updateTemplateFormState = (updates: Partial<TemplateFormState>) => {
    setTemplateForm((prev) => ({ ...prev, ...updates }));
  };

  const toggleTemplateTagSelection = (tagId: number) => {
    setTemplateForm((prev) => {
      const exists = prev.tagIds.includes(tagId);
      const tagIds = exists ? prev.tagIds.filter((id) => id !== tagId) : [...prev.tagIds, tagId];
      return { ...prev, tagIds };
    });
  };

  const handleTemplateRecurringToggle = (isRecurring: boolean) => {
    setTemplateForm((prev) => ({
      ...prev,
      isRecurring,
      recurrencePattern: isRecurring ? prev.recurrencePattern : 'daily'
    }));
  };

  const closeTemplateModal = () => {
    resetTemplateModalState();
  };

  const requestDeleteTemplate = (template: Template) => {
    setTemplateManagerError(null);
    setTemplateDeleteTarget(template);
  };

  const cancelDeleteTemplate = () => {
    setTemplateDeleteTarget(null);
  };

  const confirmDeleteTemplate = async () => {
    if (!templateDeleteTarget) {
      return;
    }

    setTemplateManagerError(null);
    try {
      const response = await fetch(`/api/templates/${templateDeleteTarget.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({ error: 'Failed to delete template' }));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? 'Failed to delete template');
      }
      setTemplateNotice(`Deleted template "${templateDeleteTarget.name}".`);
      setTemplateDeleteTarget(null);
      await loadTemplates();
    } catch (error) {
      setTemplateManagerError((error as Error).message);
    }
  };

  const openTemplateManagerModal = () => {
    setTemplateManagerError(null);
    setTemplateSearch('');
    setTemplateManagerOpen(true);
  };

  const clearTemplateNotice = () => {
    setTemplateNotice(null);
    setTemplateMissingTags([]);
  };

  const openTemplateUseModal = (templateId?: number) => {
    if (templates.length === 0) {
      setTemplateNotice('No templates available yet. Save a template from an existing todo first.');
      return;
    }
    const fallbackId = templates[0]?.id ?? null;
    setTemplateUseTargetId(templateId ?? fallbackId);
    setTemplateUseDueDate('');
    setTemplateUseOffset('');
    setTemplateUseError(null);
    setTemplateUseSubmitting(false);
    setTemplateMissingTags([]);
    setTemplateUseModalOpen(true);
  };

  const closeTemplateUseModal = () => {
    setTemplateUseModalOpen(false);
    setTemplateUseTargetId(null);
    setTemplateUseError(null);
    setTemplateUseSubmitting(false);
  };

  const handleTemplateUseSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTemplateUseError(null);
    if (templateUseTargetId == null) {
      setTemplateUseError('Select a template to use.');
      return;
    }

    let dueDateIso: string | null | undefined;
    if (templateUseDueDate.trim().length > 0) {
      const converted = toSingaporeIso(templateUseDueDate.trim());
      if (!converted) {
        setTemplateUseError('Provide a valid due date.');
        return;
      }
      dueDateIso = converted;
    }

    let dueOffsetValue: number | null | undefined;
    if (templateUseOffset.trim().length > 0) {
      const numeric = Number.parseInt(templateUseOffset.trim(), 10);
      if (!Number.isInteger(numeric) || numeric < 0) {
        setTemplateUseError('Offset must be a non-negative integer.');
        return;
      }
      dueOffsetValue = numeric;
    }

    setTemplateUseSubmitting(true);
    try {
      const response = await fetch(`/api/templates/${templateUseTargetId}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dueDate: dueDateIso ?? undefined,
          dueOffsetDays: dueOffsetValue ?? undefined
        })
      });

      const data = await response.json().catch(() => ({ error: 'Failed to use template' }));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? 'Failed to use template');
      }

      const { todo, missingTagIds } = data as {
        todo: Todo;
        missingTagIds?: number[];
      };

      setTodos((prev) => [todo, ...prev.filter((existing) => existing.id !== todo.id)]);
      if (todo.subtasks.length > 0) {
        setExpandedTodoIds((prev) => (prev.includes(todo.id) ? prev : [todo.id, ...prev]));
      }
      setTemplateMissingTags(missingTagIds ?? []);
      setTemplateNotice('Todo created from template.');
      closeTemplateUseModal();
      await loadTags();
    } catch (error) {
      setTemplateUseError((error as Error).message);
    } finally {
      setTemplateUseSubmitting(false);
    }
  };

  const handleTemplateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTemplateFormError(null);

    const trimmedName = templateForm.name.trim();
    if (trimmedName.length === 0) {
      setTemplateFormError('Template name is required.');
      return;
    }
    if (trimmedName.length > 80) {
      setTemplateFormError('Template name must be at most 80 characters.');
      return;
    }

    const trimmedDescription = templateForm.description.trim();
    if (trimmedDescription.length > 500) {
      setTemplateFormError('Description must be 500 characters or fewer.');
      return;
    }

    const trimmedCategory = templateForm.category.trim();
    if (trimmedCategory.length > 40) {
      setTemplateFormError('Category must be 40 characters or fewer.');
      return;
    }

    const todoTitle = templateForm.todoTitle.trim();
    if (todoTitle.length === 0) {
      setTemplateFormError('Todo title is required.');
      return;
    }
    if (todoTitle.length > 200) {
      setTemplateFormError('Todo title must be at most 200 characters.');
      return;
    }

    const todoDescription = templateForm.todoDescription.trim();
    if (todoDescription.length > 2000) {
      setTemplateFormError('Todo description must be at most 2000 characters.');
      return;
    }

    const dueOffset = Number.parseInt(templateForm.dueOffsetDays, 10);
    if (!Number.isFinite(dueOffset) || dueOffset < 0) {
      setTemplateFormError('Due offset must be a non-negative integer.');
      return;
    }

    const reminderMinutes = templateForm.reminderMinutes
      ? Number.parseInt(templateForm.reminderMinutes, 10)
      : null;
  if (reminderMinutes != null && !reminderOptions.includes(reminderMinutes)) {
      setTemplateFormError('Invalid reminder option selected.');
      return;
    }

    if (!priorityOptions.includes(templateForm.priority)) {
      setTemplateFormError('Invalid priority selected.');
      return;
    }

    const recurrencePattern = templateForm.isRecurring ? templateForm.recurrencePattern : null;
    if (templateForm.isRecurring && !recurrencePattern) {
      setTemplateFormError('Recurring templates require a recurrence pattern.');
      return;
    }

    const payload: Record<string, unknown> = {
      name: trimmedName,
      description: trimmedDescription.length === 0 ? null : trimmedDescription,
      category: trimmedCategory.length === 0 ? null : trimmedCategory,
      todoTitle,
      todoDescription,
      priority: templateForm.priority,
      recurrencePattern,
      reminderMinutes,
      dueOffsetDays: dueOffset,
      tagIds: templateForm.tagIds,
      subtasks: templateSubtasksPreview,
      estimatedDurationMinutes: null
    };

    let endpoint = '/api/templates';
    let method: 'POST' | 'PUT' = 'POST';
    if (templateModalMode === 'edit') {
      if (!templateEditTarget) {
        setTemplateFormError('Template not selected for editing.');
        return;
      }
      endpoint = `/api/templates/${templateEditTarget.id}`;
      method = 'PUT';
    } else if (!templateSourceTodo) {
      setTemplateFormError('Unable to determine template source todo.');
      return;
    }

    setTemplateSubmitting(true);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          reminderMinutes,
          recurrencePattern,
          tagIds: templateForm.tagIds,
          subtasks: templateSubtasksPreview
        })
      });

      const data = await response.json().catch(() => ({ error: 'Failed to save template' }));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? 'Failed to save template');
      }

      setTemplateNotice(templateModalMode === 'edit' ? 'Template updated successfully.' : 'Template created successfully.');
      resetTemplateModalState();
      await loadTemplates();
      if (method === 'POST') {
        openTemplateManagerModal();
      }
    } catch (error) {
      setTemplateFormError((error as Error).message);
    } finally {
      setTemplateSubmitting(false);
    }
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
      subtasks: [],
      progress: { completed: 0, total: 0, percent: 0 },
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

      setSelectedTagIds((prev) => prev.filter((id) => id !== tagDeleteTarget.id));

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
    setSubtaskInputs((prev) => {
      if (!(todo.id in prev)) {
        return prev;
      }
      const { [todo.id]: _removed, ...rest } = prev;
      return rest;
    });
    setSubtaskErrors((prev) => {
      if (!(todo.id in prev)) {
        return prev;
      }
      const { [todo.id]: _removed, ...rest } = prev;
      return rest;
    });
    setExpandedTodoIds((prev) => prev.filter((id) => id !== todo.id));
    setCreatingSubtaskTodoIds((prev) => prev.filter((id) => id !== todo.id));
    setUpdatingSubtaskIds((prev) => prev.filter((id) => !todo.subtasks.some((subtask) => subtask.id === id)));
    setSubtaskEditDrafts((prev) => {
      if (todo.subtasks.length === 0) {
        return prev;
      }
      const copy = { ...prev };
      for (const subtask of todo.subtasks) {
        delete copy[subtask.id];
      }
      return copy;
    });
    if (editingSubtaskId != null && todo.subtasks.some((subtask) => subtask.id === editingSubtaskId)) {
      setEditingSubtaskId(null);
    }

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

  const applySubtaskState = (todoId: number, updater: (todo: Todo) => Todo) => {
    setTodos((prev) => prev.map((todo) => (todo.id === todoId ? updater(todo) : todo)));
    setEditing((current) => {
      if (!current || current.id !== todoId) {
        return current;
      }
      return updater(current);
    });
  };

  const addCreatingTodo = (todoId: number) => {
    setCreatingSubtaskTodoIds((prev) => (prev.includes(todoId) ? prev : [...prev, todoId]));
  };

  const removeCreatingTodo = (todoId: number) => {
    setCreatingSubtaskTodoIds((prev) => prev.filter((id) => id !== todoId));
  };

  const addUpdatingSubtask = (subtaskId: number) => {
    setUpdatingSubtaskIds((prev) => (prev.includes(subtaskId) ? prev : [...prev, subtaskId]));
  };

  const removeUpdatingSubtask = (subtaskId: number) => {
    setUpdatingSubtaskIds((prev) => prev.filter((id) => id !== subtaskId));
  };

  const handleToggleSubtaskSection = (todoId: number) => {
    setExpandedTodoIds((prev) => (prev.includes(todoId) ? prev.filter((id) => id !== todoId) : [...prev, todoId]));
  };

  const handleSubtaskDraftChange = (todoId: number, value: string) => {
    setSubtaskInputs((prev) => ({ ...prev, [todoId]: value }));
    setSubtaskErrors((prev) => ({ ...prev, [todoId]: null }));
  };

  const handleSubtaskEditDraftChange = (subtaskId: number, value: string) => {
    setSubtaskEditDrafts((prev) => ({ ...prev, [subtaskId]: value }));
  };

  const handleCreateSubtask = async (todo: Todo) => {
    const draft = (subtaskInputs[todo.id] ?? '').trim();
    if (draft.length === 0) {
      setSubtaskErrors((prev) => ({ ...prev, [todo.id]: 'Subtask title is required' }));
      return;
    }

    addCreatingTodo(todo.id);

    try {
      const response = await fetch(`/api/todos/${todo.id}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft })
      });
      const raw = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || raw == null || typeof raw !== 'object') {
        throw new Error('Failed to create subtask');
      }
      if ('error' in raw) {
        const message = (raw as { error?: string }).error;
        throw new Error(message ?? 'Failed to create subtask');
      }
      const { subtask, progress } = raw as { subtask: Subtask; progress: ProgressStats };
      applySubtaskState(todo.id, (current) => {
        const nextSubtasks = sortSubtasks([
          ...current.subtasks.filter((item) => item.id !== subtask.id),
          subtask
        ]);
        return { ...current, subtasks: nextSubtasks, progress };
      });
      setSubtaskInputs((prev) => ({ ...prev, [todo.id]: '' }));
      setSubtaskErrors((prev) => ({ ...prev, [todo.id]: null }));
      setExpandedTodoIds((prev) => (prev.includes(todo.id) ? prev : [...prev, todo.id]));
    } catch (error) {
      setSubtaskErrors((prev) => ({ ...prev, [todo.id]: (error as Error).message }));
    } finally {
      removeCreatingTodo(todo.id);
    }
  };

  const handleStartSubtaskEdit = (todoId: number, subtask: Subtask) => {
    setEditingSubtaskId(subtask.id);
    setSubtaskEditDrafts((prev) => ({ ...prev, [subtask.id]: subtask.title }));
    setSubtaskErrors((prev) => ({ ...prev, [todoId]: null }));
  };

  const handleCancelSubtaskEdit = () => {
    setSubtaskEditDrafts((prev) => {
      if (editingSubtaskId == null) {
        return prev;
      }
      const { [editingSubtaskId]: _removed, ...rest } = prev;
      return rest;
    });
    setEditingSubtaskId(null);
  };

  const handleSaveSubtaskEdit = async (todoId: number, subtask: Subtask) => {
    const draft = (subtaskEditDrafts[subtask.id] ?? '').trim();
    if (draft.length === 0) {
      setSubtaskErrors((prev) => ({ ...prev, [todoId]: 'Subtask title is required' }));
      return;
    }

    addUpdatingSubtask(subtask.id);

    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft })
      });
      const raw = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || raw == null || typeof raw !== 'object') {
        throw new Error('Failed to update subtask');
      }
      if ('error' in raw) {
        const message = (raw as { error?: string }).error;
        throw new Error(message ?? 'Failed to update subtask');
      }
      const { subtask: updatedSubtask, progress } = raw as { subtask: Subtask; progress: ProgressStats };
      applySubtaskState(todoId, (current) => {
        const nextSubtasks = sortSubtasks([
          ...current.subtasks.filter((item) => item.id !== updatedSubtask.id),
          updatedSubtask
        ]);
        return { ...current, subtasks: nextSubtasks, progress };
      });
      setSubtaskErrors((prev) => ({ ...prev, [todoId]: null }));
      setSubtaskEditDrafts((prev) => {
        const { [subtask.id]: _removed, ...rest } = prev;
        return rest;
      });
      setEditingSubtaskId(null);
    } catch (error) {
      setSubtaskErrors((prev) => ({ ...prev, [todoId]: (error as Error).message }));
    } finally {
      removeUpdatingSubtask(subtask.id);
    }
  };

  const handleToggleSubtask = async (todo: Todo, subtask: Subtask, isCompleted: boolean) => {
    addUpdatingSubtask(subtask.id);

    try {
      const response = await fetch(`/api/subtasks/${subtask.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted })
      });
      const raw = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || raw == null || typeof raw !== 'object') {
        throw new Error('Failed to toggle subtask');
      }
      if ('error' in raw) {
        const message = (raw as { error?: string }).error;
        throw new Error(message ?? 'Failed to toggle subtask');
      }
      const { subtask: updatedSubtask, progress } = raw as { subtask: Subtask; progress: ProgressStats };
      applySubtaskState(todo.id, (current) => {
        const nextSubtasks = sortSubtasks([
          ...current.subtasks.filter((item) => item.id !== updatedSubtask.id),
          updatedSubtask
        ]);
        return { ...current, subtasks: nextSubtasks, progress };
      });
      setSubtaskErrors((prev) => ({ ...prev, [todo.id]: null }));
    } catch (error) {
      setSubtaskErrors((prev) => ({ ...prev, [todo.id]: (error as Error).message }));
    } finally {
      removeUpdatingSubtask(subtask.id);
    }
  };

  const handleDeleteSubtask = async (todoId: number, subtask: Subtask) => {
    addUpdatingSubtask(subtask.id);

    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, { method: 'DELETE' });
      const raw = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || raw == null || typeof raw !== 'object') {
        throw new Error('Failed to delete subtask');
      }
      if ('error' in raw) {
        const message = (raw as { error?: string }).error;
        throw new Error(message ?? 'Failed to delete subtask');
      }
      const { progress } = raw as { progress: ProgressStats };
      applySubtaskState(todoId, (current) => {
        const nextSubtasks = current.subtasks.filter((item) => item.id !== subtask.id);
        return { ...current, subtasks: sortSubtasks(nextSubtasks), progress };
      });
      setSubtaskErrors((prev) => ({ ...prev, [todoId]: null }));
      setSubtaskEditDrafts((prev) => {
        const { [subtask.id]: _removed, ...rest } = prev;
        return rest;
      });
      if (editingSubtaskId === subtask.id) {
        setEditingSubtaskId(null);
      }
      if (progress.total === 0) {
        setExpandedTodoIds((prev) => prev.filter((id) => id !== todoId));
      }
    } catch (error) {
      setSubtaskErrors((prev) => ({ ...prev, [todoId]: (error as Error).message }));
    } finally {
      removeUpdatingSubtask(subtask.id);
    }
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

      {templateNotice && (
        <div className="rounded border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
          <div className="flex items-start justify-between gap-3">
            <span>{templateNotice}</span>
            <button
              type="button"
              onClick={clearTemplateNotice}
              className="text-xs font-semibold uppercase tracking-wide text-blue-200 hover:text-white"
            >
              Dismiss
            </button>
          </div>
          {templateMissingTags.length > 0 && (
            <p className="mt-2 text-xs text-blue-200/80">
              Missing tags: {templateMissingTags.join(', ')}. These tags no longer exist and were skipped.
            </p>
          )}
        </div>
      )}

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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Create Todo
            </button>
            <button
              type="button"
              onClick={() => openTemplateUseModal()}
              disabled={templates.length === 0}
              className="rounded border border-blue-500 px-4 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
            >
              Use Template
            </button>
            <button
              type="button"
              onClick={openTemplateManagerModal}
              className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-blue-500 hover:text-blue-200"
            >
              Manage Templates
            </button>
          </div>
        </form>
      </section>

      {uiState.loading && <p>Loading todos…</p>}
      {uiState.error && <p className="text-sm text-red-400">{uiState.error}</p>}

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="todo-search" className="text-sm font-semibold text-slate-200">
              Search todos
            </label>
            <input
              id="todo-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search todos..."
              aria-label="Search todos"
              className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-200">Priority</span>
            <div className="flex flex-wrap gap-2">
              {priorityFilterOptions.map((option) => {
                const active = selectedPriority === option;
                const label = option === 'all' ? 'All' : option.toUpperCase();
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedPriority(option)}
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

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200">Tags</span>
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
                  const active = selectedTagIds.includes(tag.id);
                  const style = getTagBadgeStyle(tag.color);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleTagToggle(tag.id)}
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
        </div>

        {hasActiveFilters && (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase">
              <span className="font-semibold text-slate-300">Active filters:</span>
              {hasSearchFilter && (
                <span className="flex items-center gap-1 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/20 px-3 py-1 text-fuchsia-100">
                  Search: {searchQueryDisplay}
                  <button
                    type="button"
                    onClick={clearSearchFilter}
                    className="text-[10px] font-semibold uppercase text-fuchsia-200 hover:text-fuchsia-100"
                  >
                    Clear
                  </button>
                </span>
              )}
              {hasPriorityFilter && (
                <span className="flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/20 px-3 py-1 text-blue-100">
                  Priority: {selectedPriority.toUpperCase()}
                  <button
                    type="button"
                    onClick={clearPriorityFilter}
                    className="text-[10px] font-semibold uppercase text-blue-200 hover:text-blue-100"
                  >
                    Clear
                  </button>
                </span>
              )}
              {selectedTagIds.map((tagId) => {
                const tag = tags.find((entry) => entry.id === tagId);
                if (!tag) {
                  return null;
                }
                const style = getTagBadgeStyle(tag.color);
                return (
                  <span
                    key={tagId}
                    className="flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                    style={style}
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => handleTagToggle(tagId)}
                      className="text-[10px] font-semibold uppercase"
                      aria-label={`Remove tag filter ${tag.name}`}
                    >
                      Remove
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={clearAllFilters}
                className="ml-auto text-[11px] font-medium text-slate-300 underline hover:text-white"
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </section>

      {hasActiveFilters && !uiState.loading && filteredTodos.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          No todos match your current filters. Try adjusting your search or clearing filters.
        </div>
      )}

      <section className="flex flex-col gap-8">
        <TodoSection
          title="Overdue"
          description="Tasks past their due date"
          emptyMessage="Nothing overdue — great job!"
          todos={sections.overdue}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
          onSaveTemplate={openSaveTemplateModal}
          onTagToggle={handleTagToggle}
          activeTagIds={selectedTagIds}
          subtaskDrafts={subtaskInputs}
          subtaskErrors={subtaskErrors}
          subtaskEditDrafts={subtaskEditDrafts}
          editingSubtaskId={editingSubtaskId}
          expandedTodoIds={expandedTodoIds}
          creatingSubtaskIds={creatingSubtaskTodoIds}
          updatingSubtaskIds={updatingSubtaskIds}
          onToggleSubtaskSection={handleToggleSubtaskSection}
          onSubtaskDraftChange={handleSubtaskDraftChange}
          onCreateSubtask={handleCreateSubtask}
          onStartSubtaskEdit={handleStartSubtaskEdit}
          onCancelSubtaskEdit={handleCancelSubtaskEdit}
          onSaveSubtaskEdit={handleSaveSubtaskEdit}
          onSubtaskEditDraftChange={handleSubtaskEditDraftChange}
          onToggleSubtask={handleToggleSubtask}
          onDeleteSubtask={handleDeleteSubtask}
        />
        <TodoSection
          title="Active"
          description="Upcoming and ongoing tasks"
          emptyMessage="No active todos. Time to add some!"
          todos={sections.active}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
          onSaveTemplate={openSaveTemplateModal}
          onTagToggle={handleTagToggle}
          activeTagIds={selectedTagIds}
          subtaskDrafts={subtaskInputs}
          subtaskErrors={subtaskErrors}
          subtaskEditDrafts={subtaskEditDrafts}
          editingSubtaskId={editingSubtaskId}
          expandedTodoIds={expandedTodoIds}
          creatingSubtaskIds={creatingSubtaskTodoIds}
          updatingSubtaskIds={updatingSubtaskIds}
          onToggleSubtaskSection={handleToggleSubtaskSection}
          onSubtaskDraftChange={handleSubtaskDraftChange}
          onCreateSubtask={handleCreateSubtask}
          onStartSubtaskEdit={handleStartSubtaskEdit}
          onCancelSubtaskEdit={handleCancelSubtaskEdit}
          onSaveSubtaskEdit={handleSaveSubtaskEdit}
          onSubtaskEditDraftChange={handleSubtaskEditDraftChange}
          onToggleSubtask={handleToggleSubtask}
          onDeleteSubtask={handleDeleteSubtask}
        />
        <TodoSection
          title="Completed"
          description="Finished tasks"
          emptyMessage="No completed todos yet."
          todos={sections.completed}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
          onSaveTemplate={openSaveTemplateModal}
          onTagToggle={handleTagToggle}
          activeTagIds={selectedTagIds}
          subtaskDrafts={subtaskInputs}
          subtaskErrors={subtaskErrors}
          subtaskEditDrafts={subtaskEditDrafts}
          editingSubtaskId={editingSubtaskId}
          expandedTodoIds={expandedTodoIds}
          creatingSubtaskIds={creatingSubtaskTodoIds}
          updatingSubtaskIds={updatingSubtaskIds}
          onToggleSubtaskSection={handleToggleSubtaskSection}
          onSubtaskDraftChange={handleSubtaskDraftChange}
          onCreateSubtask={handleCreateSubtask}
          onStartSubtaskEdit={handleStartSubtaskEdit}
          onCancelSubtaskEdit={handleCancelSubtaskEdit}
          onSaveSubtaskEdit={handleSaveSubtaskEdit}
          onSubtaskEditDraftChange={handleSubtaskEditDraftChange}
          onToggleSubtask={handleToggleSubtask}
          onDeleteSubtask={handleDeleteSubtask}
        />
      </section>

      {isTemplateModalOpen && (
        <dialog open className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
          <form
            className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
            onSubmit={handleTemplateSubmit}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {templateModalMode === 'edit' ? 'Edit Template' : 'Save as Template'}
                </h2>
                <p className="text-xs text-slate-400">
                  Templates capture todo details, tags, and subtasks for quick reuse.
                </p>
              </div>
              <button
                type="button"
                onClick={closeTemplateModal}
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
              >
                Close
              </button>
            </header>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                Template name
                <input
                  value={templateForm.name}
                  onChange={(event) => updateTemplateFormState({ name: event.target.value })}
                  maxLength={80}
                  required
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Category <span className="text-xs text-slate-500">Optional</span>
                <input
                  value={templateForm.category}
                  onChange={(event) => updateTemplateFormState({ category: event.target.value })}
                  maxLength={40}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  placeholder="Work, Personal, Finance…"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm md:col-span-2">
                Description <span className="text-xs text-slate-500">Optional</span>
                <textarea
                  value={templateForm.description}
                  onChange={(event) => updateTemplateFormState({ description: event.target.value })}
                  maxLength={500}
                  className="min-h-[60px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  placeholder="Explain when to use this template."
                />
              </label>
              <label className="flex flex-col gap-2 text-sm md:col-span-2">
                Todo title
                <input
                  value={templateForm.todoTitle}
                  onChange={(event) => updateTemplateFormState({ todoTitle: event.target.value })}
                  maxLength={200}
                  required
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm md:col-span-2">
                Todo description <span className="text-xs text-slate-500">Optional</span>
                <textarea
                  value={templateForm.todoDescription}
                  onChange={(event) => updateTemplateFormState({ todoDescription: event.target.value })}
                  maxLength={2000}
                  className="min-h-[80px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Priority
                <select
                  value={templateForm.priority}
                  onChange={(event) => updateTemplateFormState({ priority: event.target.value as Priority })}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  {priorityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={templateForm.isRecurring}
                  onChange={(event) => handleTemplateRecurringToggle(event.target.checked)}
                />
                Recurring todo
              </label>
              {templateForm.isRecurring && (
                <label className="flex flex-col gap-2 text-sm">
                  Recurrence pattern
                  <select
                    value={templateForm.recurrencePattern}
                    onChange={(event) => updateTemplateFormState({ recurrencePattern: event.target.value as RecurrencePattern })}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  >
                    {recurrenceOptions.map((option) => (
                      <option key={option} value={option}>
                        {option.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-2 text-sm">
                Reminder
                <select
                  value={templateForm.reminderMinutes}
                  onChange={(event) => updateTemplateFormState({ reminderMinutes: event.target.value })}
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
              <label className="flex flex-col gap-2 text-sm">
                Due offset (days)
                <input
                  type="number"
                  min={0}
                  value={templateForm.dueOffsetDays}
                  onChange={(event) => updateTemplateFormState({ dueOffsetDays: event.target.value })}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Tags</h3>
                <span className="text-xs text-slate-400">{templateForm.tagIds.length} selected</span>
              </div>
              {tags.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">No tags yet. Create tags to attach them to templates.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const checked = templateForm.tagIds.includes(tag.id);
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
                          onChange={() => toggleTemplateTagSelection(tag.id)}
                          className="accent-blue-500"
                        />
                        <span className="flex items-center gap-1">
                          <span
                            className="h-3 w-3 rounded-full border border-slate-800"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-6 rounded border border-slate-800 bg-slate-950/40 p-4">
              <h3 className="text-sm font-semibold text-slate-200">Subtasks snapshot</h3>
              {templateSubtasksPreview.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">No subtasks captured for this template.</p>
              ) : (
                <ul className="mt-3 flex max-h-40 flex-col gap-2 overflow-y-auto">
                  {templateSubtasksPreview.map((subtask) => (
                    <li key={`${subtask.position}-${subtask.title}`} className="rounded border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-200">
                      <span className="font-semibold text-slate-300">{subtask.position}.</span> {subtask.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {templateFormError && <p className="mt-4 text-sm text-red-400">{templateFormError}</p>}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeTemplateModal}
                className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-blue-500 hover:text-blue-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={templateSubmitting}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
              >
                {templateSubmitting
                  ? 'Saving…'
                  : templateModalMode === 'edit'
                    ? 'Save changes'
                    : 'Save template'}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {isTemplateManagerOpen && (
        <dialog open className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Template Library</h2>
                <p className="text-xs text-slate-400">Search, edit, and launch templates grouped by category.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="search"
                  value={templateSearch}
                  onChange={(event) => setTemplateSearch(event.target.value)}
                  placeholder="Search templates"
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setTemplateManagerOpen(false)}
                  className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
                >
                  Close
                </button>
              </div>
            </header>

            {templateManagerError && <p className="mt-4 text-sm text-red-400">{templateManagerError}</p>}

            {templatesLoading ? (
              <p className="mt-6 text-sm text-slate-400">Loading templates…</p>
            ) : filteredTemplates.length === 0 ? (
              <p className="mt-6 text-sm text-slate-400">No templates found. Save a todo as a template to get started.</p>
            ) : (
              <div className="mt-6 flex flex-col gap-6">
                {templatesByCategory.map(([category, entries]) => (
                  <section key={category} className="rounded border border-slate-800 bg-slate-950/40 p-4">
                    <header className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-200">{category}</h3>
                      <span className="text-xs text-slate-400">{entries.length} template{entries.length === 1 ? '' : 's'}</span>
                    </header>
                    <ul className="mt-4 flex flex-col gap-3">
                      {entries.map((template) => (
                        <li
                          key={template.id}
                          className="rounded border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200"
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="flex-1">
                              <p className="text-base font-semibold text-slate-100">{template.name}</p>
                              {template.description && (
                                <p className="text-xs text-slate-400">{template.description}</p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase text-slate-400">
                                <PriorityBadge priority={template.priority} />
                                {template.recurrencePattern && (
                                  <span className="rounded border border-blue-500/40 px-2 py-1 text-blue-200">
                                    Repeats {template.recurrencePattern.toUpperCase()}
                                  </span>
                                )}
                                {template.reminderMinutes != null && (
                                  <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">
                                    Reminder {template.reminderMinutes}m
                                  </span>
                                )}
                                <span className="rounded border border-slate-700 px-2 py-1">
                                  Offset {template.dueOffsetDays}d
                                </span>
                                <span className="rounded border border-slate-700 px-2 py-1">
                                  {template.tagIds.length} tag{template.tagIds.length === 1 ? '' : 's'}
                                </span>
                                <span className="rounded border border-slate-700 px-2 py-1">
                                  {template.subtasks.length} subtask{template.subtasks.length === 1 ? '' : 's'}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => openTemplateUseModal(template.id)}
                                className="rounded border border-green-600 px-3 py-1 text-xs text-green-200 hover:bg-green-600/20"
                              >
                                Use
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditTemplateModal(template)}
                                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => requestDeleteTemplate(template)}
                                className="rounded border border-red-600 px-3 py-1 text-xs text-red-200 hover:border-red-500/80"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {templateDeleteTarget && (
              <div className="mt-6 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p>
                  Delete template <strong>{templateDeleteTarget.name}</strong>? Existing todos created from it will not be affected.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelDeleteTemplate}
                    className="rounded border border-amber-500 px-3 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteTemplate}
                    className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
                  >
                    Delete template
                  </button>
                </div>
              </div>
            )}
          </div>
        </dialog>
      )}

      {isTemplateUseModalOpen && (
        <dialog open className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
          <form
            className="w-full max-w-xl rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
            onSubmit={handleTemplateUseSubmit}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Use Template</h2>
                <p className="text-xs text-slate-400">Select a template and optionally adjust due date or offset.</p>
              </div>
              <button
                type="button"
                onClick={closeTemplateUseModal}
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-blue-500 hover:text-blue-200"
              >
                Close
              </button>
            </header>

            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-2 text-sm">
                Template
                <select
                  value={templateUseTargetId ?? ''}
                  onChange={(event) => setTemplateUseTargetId(event.target.value ? Number.parseInt(event.target.value, 10) : null)}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.category ? `${template.name} (${template.category})` : template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Due date (overrides offset)
                <input
                  type="datetime-local"
                  value={templateUseDueDate}
                  onChange={(event) => setTemplateUseDueDate(event.target.value)}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Due offset (days)
                <input
                  type="number"
                  min={0}
                  value={templateUseOffset}
                  onChange={(event) => setTemplateUseOffset(event.target.value)}
                  className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
            </div>

            {selectedTemplateForUse && (
              <div className="mt-5 rounded border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-300">
                <p className="text-sm font-semibold text-slate-200">Preview</p>
                <p className="mt-1 text-slate-300">{selectedTemplateForUse.todoTitle}</p>
                {selectedTemplateForUse.todoDescription && (
                  <p className="mt-1 text-slate-400">{selectedTemplateForUse.todoDescription}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase text-slate-400">
                  <PriorityBadge priority={selectedTemplateForUse.priority} />
                  {selectedTemplateForUse.recurrencePattern && (
                    <span className="rounded border border-blue-500/40 px-2 py-1 text-blue-200">
                      Repeats {selectedTemplateForUse.recurrencePattern.toUpperCase()}
                    </span>
                  )}
                  {selectedTemplateForUse.reminderMinutes != null && (
                    <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">
                      Reminder {selectedTemplateForUse.reminderMinutes}m
                    </span>
                  )}
                  <span className="rounded border border-slate-700 px-2 py-1">
                    Offset {selectedTemplateForUse.dueOffsetDays}d
                  </span>
                  <span className="rounded border border-slate-700 px-2 py-1">
                    {selectedTemplateForUse.tagIds.length} tag{selectedTemplateForUse.tagIds.length === 1 ? '' : 's'}
                  </span>
                  <span className="rounded border border-slate-700 px-2 py-1">
                    {selectedTemplateForUse.subtasks.length} subtask{selectedTemplateForUse.subtasks.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            )}

            {templateUseError && <p className="mt-4 text-sm text-red-400">{templateUseError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeTemplateUseModal}
                className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-blue-500 hover:text-blue-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={templateUseSubmitting}
                className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-900"
              >
                {templateUseSubmitting ? 'Creating…' : 'Create Todo'}
              </button>
            </div>
          </form>
        </dialog>
      )}

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
  onSaveTemplate: (todo: Todo) => void;
  onTagToggle: (tagId: number) => void;
  activeTagIds: number[];
  subtaskDrafts: Record<number, string>;
  subtaskErrors: Record<number, string | null>;
  subtaskEditDrafts: Record<number, string>;
  editingSubtaskId: number | null;
  expandedTodoIds: number[];
  creatingSubtaskIds: number[];
  updatingSubtaskIds: number[];
  onToggleSubtaskSection: (todoId: number) => void;
  onSubtaskDraftChange: (todoId: number, value: string) => void;
  onCreateSubtask: (todo: Todo) => void;
  onStartSubtaskEdit: (todoId: number, subtask: Subtask) => void;
  onCancelSubtaskEdit: () => void;
  onSaveSubtaskEdit: (todoId: number, subtask: Subtask) => void;
  onSubtaskEditDraftChange: (subtaskId: number, value: string) => void;
  onToggleSubtask: (todo: Todo, subtask: Subtask, isCompleted: boolean) => void;
  onDeleteSubtask: (todoId: number, subtask: Subtask) => void;
}

function TodoSection({
  title,
  description,
  emptyMessage,
  todos,
  onToggle,
  onEdit,
  onDelete,
  onSaveTemplate,
  onTagToggle,
  activeTagIds,
  subtaskDrafts,
  subtaskErrors,
  subtaskEditDrafts,
  editingSubtaskId,
  expandedTodoIds,
  creatingSubtaskIds,
  updatingSubtaskIds,
  onToggleSubtaskSection,
  onSubtaskDraftChange,
  onCreateSubtask,
  onStartSubtaskEdit,
  onCancelSubtaskEdit,
  onSaveSubtaskEdit,
  onSubtaskEditDraftChange,
  onToggleSubtask,
  onDeleteSubtask
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
          {todos.map((todo) => {
            const isExpanded = expandedTodoIds.includes(todo.id);
            const subtaskDraft = subtaskDrafts[todo.id] ?? '';
            const subtaskError = subtaskErrors[todo.id] ?? null;
            const isCreating = creatingSubtaskIds.includes(todo.id);
            return (
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
                        {todo.reminderMinutes != null && (
                          <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">Reminder {todo.reminderMinutes}m</span>
                        )}
                      </div>
                      {todo.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {todo.tags.map((tag) => {
                            const active = activeTagIds.includes(tag.id);
                            const style = getTagBadgeStyle(tag.color);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => onTagToggle(tag.id)}
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
                      className="rounded border border-blue-600 px-3 py-1 text-xs text-blue-200 hover:bg-blue-600/20"
                      onClick={() => onSaveTemplate(todo)}
                    >
                      Save template
                    </button>
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

                <div className="mt-4 rounded border border-slate-800 bg-slate-950/40">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-300"
                    onClick={() => onToggleSubtaskSection(todo.id)}
                    aria-expanded={isExpanded}
                  >
                    <span>Subtasks</span>
                    <span className="text-[11px] text-slate-400">
                      {todo.progress.total > 0
                        ? `${todo.progress.completed}/${todo.progress.total} · ${todo.progress.percent}%`
                        : 'No subtasks yet'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-800 p-3">
                      {todo.progress.total > 0 ? (
                        <div>
                          <div className="flex items-center justify-between text-xs text-slate-300">
                            <span>
                              {todo.progress.completed}/{todo.progress.total} completed
                            </span>
                            <span>{todo.progress.percent}%</span>
                          </div>
                          <div
                            className="mt-1 h-2 w-full rounded bg-slate-800"
                            role="progressbar"
                            aria-valuenow={todo.progress.percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className={`h-full rounded ${todo.progress.percent === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                              style={{ width: `${todo.progress.percent}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">No subtasks yet</p>
                      )}

                      <form
                        className="mt-3 flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onCreateSubtask(todo);
                        }}
                      >
                        <input
                          type="text"
                          value={subtaskDraft}
                          onChange={(event) => onSubtaskDraftChange(todo.id, event.target.value)}
                          maxLength={200}
                          placeholder="Add a subtask..."
                          className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                        />
                        <button
                          type="submit"
                          className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60"
                          disabled={isCreating}
                        >
                          Add
                        </button>
                      </form>
                      {subtaskError && <p className="mt-2 text-xs text-red-400">{subtaskError}</p>}

                      {todo.subtasks.length > 0 && (
                        <ul className="mt-4 flex flex-col gap-2">
                          {todo.subtasks.map((subtask) => {
                            const isEditingSubtask = editingSubtaskId === subtask.id;
                            const draftValue = subtaskEditDrafts[subtask.id] ?? subtask.title;
                            const isUpdating = updatingSubtaskIds.includes(subtask.id);
                            return (
                              <li key={subtask.id} className="rounded border border-slate-800 bg-slate-950/70 p-3">
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={subtask.isCompleted}
                                    disabled={isUpdating}
                                    onChange={(event) => onToggleSubtask(todo, subtask, event.target.checked)}
                                    aria-label={`Mark ${subtask.title} as ${subtask.isCompleted ? 'incomplete' : 'complete'}`}
                                  />
                                  <div className="flex-1">
                                    {isEditingSubtask ? (
                                      <form
                                        onSubmit={(event) => {
                                          event.preventDefault();
                                          onSaveSubtaskEdit(todo.id, subtask);
                                        }}
                                      >
                                        <input
                                          type="text"
                                          value={draftValue}
                                          onChange={(event) => onSubtaskEditDraftChange(subtask.id, event.target.value)}
                                          maxLength={200}
                                          className="w-full rounded border border-blue-500 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                                        />
                                        <div className="mt-2 flex gap-2">
                                          <button
                                            type="button"
                                            onClick={onCancelSubtaskEdit}
                                            className="rounded border border-slate-700 px-3 py-1 text-xs"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="submit"
                                            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                                            disabled={isUpdating}
                                          >
                                            Save
                                          </button>
                                        </div>
                                      </form>
                                    ) : (
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          <p
                                            className={`text-sm ${subtask.isCompleted ? 'text-slate-400 line-through' : 'text-slate-200'}`}
                                          >
                                            {subtask.title}
                                          </p>
                                          <p className="text-[11px] text-slate-500">Position {subtask.position}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            className="rounded border border-slate-700 px-2 py-1 text-[11px]"
                                            onClick={() => onStartSubtaskEdit(todo.id, subtask)}
                                          >
                                            Rename
                                          </button>
                                          <button
                                            type="button"
                                            className="rounded border border-red-600 px-2 py-1 text-[11px] text-red-300 disabled:opacity-60"
                                            onClick={() => onDeleteSubtask(todo.id, subtask)}
                                            disabled={isUpdating}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
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
