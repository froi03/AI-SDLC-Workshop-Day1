import type { Priority, Todo } from '@/lib/db';

export interface TodoFilterOptions {
  query?: string;
  priority?: Priority | null;
  tagIds?: number[];
}

function normaliseQuery(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value.trim().toLowerCase();
}

function normaliseTagIds(tagIds: number[] | undefined): number[] {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }
  const unique = new Set<number>();
  for (const tagId of tagIds) {
    if (Number.isInteger(tagId) && tagId > 0) {
      unique.add(tagId);
    }
  }
  return Array.from(unique.values()).sort((a, b) => a - b);
}

export function filterTodos(todos: Todo[], options: TodoFilterOptions): Todo[] {
  const query = normaliseQuery(options.query);
  const priority = options.priority ?? null;
  const tagIds = normaliseTagIds(options.tagIds);

  if (!query && priority == null && tagIds.length === 0) {
    return todos;
  }

  return todos.filter((todo) => {
    if (priority != null && todo.priority !== priority) {
      return false;
    }

    if (tagIds.length > 0) {
      const todoTagIds = todo.tags.map((tag) => tag.id);
      for (const tagId of tagIds) {
        if (!todoTagIds.includes(tagId)) {
          return false;
        }
      }
    }

    if (query) {
      const title = todo.title.toLowerCase();
      const description = todo.description.toLowerCase();
      const matchesTodo = title.includes(query) || description.includes(query);
      const matchesTag = todo.tags.some((tag) => tag.name.toLowerCase().includes(query));
      if (!matchesTodo && !matchesTag) {
        return false;
      }
    }

    return true;
  });
}
