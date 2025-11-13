import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getSingaporeNow } from './timezone';

const DB_FILENAME = 'todos.db';
const dbPath = path.join(process.cwd(), DB_FILENAME);

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, '');
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
    due_date TEXT,
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT CHECK (recurrence_pattern IN ('daily','weekly','monthly','yearly')),
  reminder_minutes INTEGER,
  last_notification_sent TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
  CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
  CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(is_completed);
  CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(user_id, priority);
`);

ensureTodoConstraints();
ensureTagTables();

const ensureDefaultUser = db.prepare(`
  INSERT INTO users (id, email)
  SELECT 1, 'demo@example.com'
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1)
`);

ensureDefaultUser.run();

function ensureTodoConstraints() {
  const tableSqlRow = db
    .prepare<{ sql: string } | undefined>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'")
    .get();

  if (!tableSqlRow) {
    return;
  }

  const tableSql = tableSqlRow.sql ?? '';
  const columnInfo = db.prepare<{ name: string }>(`PRAGMA table_info('todos')`).all() as { name: string }[];
  const hasLastNotificationColumn = columnInfo.some((column) => column.name === 'last_notification_sent');

  const needsPriorityCheck = !tableSql.includes("CHECK (priority IN ('high','medium','low'))");
  const needsRecurrenceCheck = !tableSql.includes("CHECK (recurrence_pattern IN ('daily','weekly','monthly','yearly'))");

  if (needsPriorityCheck || needsRecurrenceCheck) {
    const lastNotificationSelect = hasLastNotificationColumn
      ? 'last_notification_sent'
      : 'NULL AS last_notification_sent';

    const migrate = db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS todos__migration;');

      db.exec(`
        CREATE TABLE IF NOT EXISTS todos__migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
          due_date TEXT,
          is_completed INTEGER NOT NULL DEFAULT 0,
          completed_at TEXT,
          is_recurring INTEGER NOT NULL DEFAULT 0,
          recurrence_pattern TEXT CHECK (recurrence_pattern IN ('daily','weekly','monthly','yearly')),
          reminder_minutes INTEGER,
          last_notification_sent TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);

      db.exec(`
        INSERT INTO todos__migration (
          id,
          user_id,
          title,
          description,
          priority,
          due_date,
          is_completed,
          completed_at,
          is_recurring,
          recurrence_pattern,
          reminder_minutes,
          last_notification_sent,
          created_at,
          updated_at
        )
        SELECT
          id,
          user_id,
          title,
          description,
          CASE WHEN priority IN ('high','medium','low') THEN priority ELSE 'medium' END,
          due_date,
          is_completed,
          completed_at,
          is_recurring,
          CASE WHEN recurrence_pattern IN ('daily','weekly','monthly','yearly') THEN recurrence_pattern ELSE NULL END,
          reminder_minutes,
          ${lastNotificationSelect},
          created_at,
          updated_at
        FROM todos;
      `);

      db.exec('DROP TABLE todos;');
      db.exec('ALTER TABLE todos__migration RENAME TO todos;');
    });

    migrate();
  } else if (!hasLastNotificationColumn) {
    db.exec('ALTER TABLE todos ADD COLUMN last_notification_sent TEXT;');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(is_completed);
    CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(user_id, priority);
  `);
}

function ensureTagTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      color TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (todo_id, tag_id),
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_todo_tags_tag ON todo_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_todo_tags_todo ON todo_tags(todo_id);
  `);
}

export type Priority = 'high' | 'medium' | 'low';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Tag {
  id: number;
  userId: number;
  name: string;
  color: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TagWithCounts = Tag & { todoCount: number };

export interface Todo {
  id: number;
  userId: number;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern | null;
  reminderMinutes: number | null;
  lastNotificationSent: string | null;
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
}

type TodoRow = {
  id: number;
  user_id: number;
  title: string;
  description: string;
  priority: Priority;
  due_date: string | null;
  is_completed: 0 | 1;
  completed_at: string | null;
  is_recurring: 0 | 1;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string;
};

type TagRow = {
  id: number;
  user_id: number;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type TodoTagRow = TagRow & { todo_id: number };

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTodo(row: TodoRow, tags: Tag[] = []): Todo {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    dueDate: row.due_date,
    isCompleted: Boolean(row.is_completed),
    completedAt: row.completed_at,
    isRecurring: Boolean(row.is_recurring),
    recurrencePattern: row.recurrence_pattern,
    reminderMinutes: row.reminder_minutes,
    lastNotificationSent: row.last_notification_sent,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function singaporeUtcIso(): string {
  const iso = getSingaporeNow().toUTC().toISO();
  if (!iso) {
    throw new Error('Failed to derive Singapore timestamp');
  }
  return iso;
}

function listTagsForTodoInternal(todoId: number, userId: number): Tag[] {
  const rows = selectTagsForTodoStmt.all(todoId, userId) as TagRow[];
  return rows.map(mapTag);
}

function collectTagsForTodos(userId: number, todoIds: number[]): Map<number, Tag[]> {
  const map = new Map<number, Tag[]>();
  if (todoIds.length === 0) {
    return map;
  }

  const idSet = new Set(todoIds);
  const rows = selectTodoTagsByUserStmt.all(userId) as TodoTagRow[];
  for (const row of rows) {
    if (!idSet.has(row.todo_id)) {
      continue;
    }
    const existing = map.get(row.todo_id);
    const tag = mapTag(row);
    if (existing) {
      existing.push(tag);
    } else {
      map.set(row.todo_id, [tag]);
    }
  }

  return map;
}

function ensureTodoRow(id: number, userId: number): TodoRow {
  const row = selectTodoById.get(id, userId) as TodoRow | undefined;
  if (!row) {
    throw new Error('Todo not found');
  }
  return row;
}

const selectTodos = db.prepare<TodoRow[]>(`
  SELECT *
  FROM todos
  WHERE user_id = ?
  ORDER BY
    is_completed ASC,
    CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
    due_date IS NULL ASC,
    due_date ASC,
    created_at ASC
`);

const selectTodoById = db.prepare<TodoRow | undefined>(`SELECT * FROM todos WHERE id = ? AND user_id = ?`);

const selectReminderCandidates = db.prepare<TodoRow[]>(`
  SELECT *
  FROM todos
  WHERE user_id = ?
    AND reminder_minutes IS NOT NULL
    AND due_date IS NOT NULL
    AND is_completed = 0
`);

const insertTodo = db.prepare(`
  INSERT INTO todos (
    user_id,
    title,
    description,
    priority,
    due_date,
    is_recurring,
    recurrence_pattern,
    reminder_minutes,
    last_notification_sent,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTodoStmt = db.prepare(`
  UPDATE todos
  SET
    title = COALESCE(@title, title),
    description = COALESCE(@description, description),
    priority = COALESCE(@priority, priority),
    due_date = CASE WHEN @due_date = '__NULL__' THEN NULL ELSE COALESCE(@due_date, due_date) END,
    is_completed = COALESCE(@is_completed, is_completed),
    completed_at = CASE WHEN @completed_at = '__NULL__' THEN NULL ELSE COALESCE(@completed_at, completed_at) END,
    is_recurring = COALESCE(@is_recurring, is_recurring),
    recurrence_pattern = CASE WHEN @recurrence_pattern = '__NULL__' THEN NULL ELSE COALESCE(@recurrence_pattern, recurrence_pattern) END,
    reminder_minutes = CASE WHEN @reminder_minutes = '__NULL__' THEN NULL ELSE COALESCE(@reminder_minutes, reminder_minutes) END,
    last_notification_sent = CASE WHEN @last_notification_sent = '__NULL__' THEN NULL ELSE COALESCE(@last_notification_sent, last_notification_sent) END,
    updated_at = @updated_at
  WHERE id = @id AND user_id = @user_id
`);

const deleteTodoStmt = db.prepare(`DELETE FROM todos WHERE id = ? AND user_id = ?`);
const markNotificationSentStmt = db.prepare(`
  UPDATE todos
  SET last_notification_sent = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);

const selectTagsByUserStmt = db.prepare<TagRow[]>(
  `SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC`
);

type TagWithCountRow = TagRow & { todo_count: number };

const selectTagsWithCountsStmt = db.prepare<TagWithCountRow[]>(`
  SELECT
    t.id,
    t.user_id,
    t.name,
    t.color,
    t.description,
    t.created_at,
    t.updated_at,
    COUNT(tt.todo_id) AS todo_count
  FROM tags t
  LEFT JOIN todo_tags tt ON tt.tag_id = t.id
  WHERE t.user_id = ?
  GROUP BY t.id
  ORDER BY t.name COLLATE NOCASE ASC
`);

const selectTagByIdStmt = db.prepare<TagRow | undefined>(
  `SELECT * FROM tags WHERE id = ? AND user_id = ?`
);

const insertTagStmt = db.prepare(`
  INSERT INTO tags (user_id, name, color, description, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const updateTagStmt = db.prepare(`
  UPDATE tags
  SET
    name = COALESCE(@name, name),
    color = COALESCE(@color, color),
    description = CASE WHEN @description = '__NULL__' THEN NULL ELSE COALESCE(@description, description) END,
    updated_at = @updated_at
  WHERE id = @id AND user_id = @user_id
`);

const deleteTagStmt = db.prepare(`DELETE FROM tags WHERE id = ? AND user_id = ?`);

const selectTagsForTodoStmt = db.prepare<TagRow[]>(`
  SELECT t.id, t.user_id, t.name, t.color, t.description, t.created_at, t.updated_at
  FROM todo_tags tt
  INNER JOIN tags t ON t.id = tt.tag_id
  WHERE tt.todo_id = ? AND t.user_id = ?
  ORDER BY t.name COLLATE NOCASE ASC
`);

const selectTodoTagsByUserStmt = db.prepare<TodoTagRow[]>(`
  SELECT
    tt.todo_id,
    t.id,
    t.user_id,
    t.name,
    t.color,
    t.description,
    t.created_at,
    t.updated_at
  FROM todo_tags tt
  INNER JOIN tags t ON t.id = tt.tag_id
  WHERE t.user_id = ?
  ORDER BY t.name COLLATE NOCASE ASC
`);

const attachTagStmt = db.prepare(`INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)`);
const detachTagStmt = db.prepare(`DELETE FROM todo_tags WHERE todo_id = ? AND tag_id = ?`);

export const todoDB = {
  create(args: {
    userId: number;
    title: string;
    description: string;
    priority: Priority;
    dueDate: string | null;
    isRecurring: boolean;
    recurrencePattern: RecurrencePattern | null;
    reminderMinutes: number | null;
  }): Todo {
    const now = singaporeUtcIso();

    const result = insertTodo.run(
      args.userId,
      args.title,
      args.description,
      args.priority,
      args.dueDate,
      args.isRecurring ? 1 : 0,
      args.recurrencePattern,
      args.reminderMinutes,
      null,
      now,
      now
    );

    const row = selectTodoById.get(result.lastInsertRowid as number, args.userId);
    if (!row) {
      throw new Error('Failed to create todo');
    }

    return mapTodo(row, []);
  },

  listByUser(userId: number): Todo[] {
    const rows = selectTodos.all(userId) as TodoRow[];
    const tagMap = collectTagsForTodos(userId, rows.map((row) => row.id));
    return rows.map((row) => mapTodo(row, tagMap.get(row.id) ?? []));
  },

  listReminderCandidates(userId: number): Todo[] {
    const rows = selectReminderCandidates.all(userId) as TodoRow[];
    const tagMap = collectTagsForTodos(userId, rows.map((row) => row.id));
    return rows.map((row) => mapTodo(row, tagMap.get(row.id) ?? []));
  },

  getById(id: number, userId: number): Todo | undefined {
    const row = selectTodoById.get(id, userId) as TodoRow | undefined;
    if (!row) {
      return undefined;
    }
    const tags = listTagsForTodoInternal(id, userId);
    return mapTodo(row, tags);
  },

  update(id: number, userId: number, data: Partial<Omit<Todo, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Todo {
    const now = singaporeUtcIso();

    updateTodoStmt.run({
      id,
      user_id: userId,
      title: data.title ?? null,
      description: data.description ?? null,
      priority: data.priority ?? null,
      due_date: data.dueDate === null ? '__NULL__' : data.dueDate ?? null,
      is_completed: data.isCompleted === undefined ? null : data.isCompleted ? 1 : 0,
      completed_at: data.completedAt === null ? '__NULL__' : data.completedAt ?? null,
      is_recurring: data.isRecurring === undefined ? null : data.isRecurring ? 1 : 0,
      recurrence_pattern: data.recurrencePattern === null ? '__NULL__' : data.recurrencePattern ?? null,
      reminder_minutes: data.reminderMinutes === null ? '__NULL__' : data.reminderMinutes ?? null,
      last_notification_sent: data.lastNotificationSent === null ? '__NULL__' : data.lastNotificationSent ?? null,
      updated_at: now
    });

    const row = selectTodoById.get(id, userId);
    if (!row) {
      throw new Error('Todo not found after update');
    }

    const tags = listTagsForTodoInternal(id, userId);
    return mapTodo(row, tags);
  },

  delete(id: number, userId: number): void {
    deleteTodoStmt.run(id, userId);
  },

  markNotificationsSent(userId: number, todoIds: number[], sentAtIso: string): void {
    if (todoIds.length === 0) {
      return;
    }

    const apply = db.transaction((ids: number[]) => {
      for (const todoId of ids) {
        markNotificationSentStmt.run(sentAtIso, sentAtIso, todoId, userId);
      }
    });

    apply(todoIds);
  },

  toggleComplete(id: number, userId: number, isCompleted: boolean): Todo {
    const now = singaporeUtcIso();

    updateTodoStmt.run({
      id,
      user_id: userId,
      is_completed: isCompleted ? 1 : 0,
      completed_at: isCompleted ? now : '__NULL__',
      last_notification_sent: null,
      updated_at: now
    });

    const row = selectTodoById.get(id, userId);
    if (!row) {
      throw new Error('Todo not found after toggle');
    }

    const tags = listTagsForTodoInternal(id, userId);
    return mapTodo(row, tags);
  }
};

function ensureTagRow(id: number, userId: number): TagRow {
  const row = selectTagByIdStmt.get(id, userId) as TagRow | undefined;
  if (!row) {
    throw new Error('Tag not found');
  }
  return row;
}

function normalizeDescription(input: string | null | undefined): string | null {
  if (input == null) {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Tag name cannot be empty');
  }
  return trimmed;
}

export const tagDB = {
  list(userId: number): Tag[] {
    const rows = selectTagsByUserStmt.all(userId) as TagRow[];
    return rows.map(mapTag);
  },

  listWithCounts(userId: number): TagWithCounts[] {
    const rows = selectTagsWithCountsStmt.all(userId) as TagWithCountRow[];
    return rows.map((row) => ({ ...mapTag(row), todoCount: row.todo_count }));
  },

  getById(id: number, userId: number): Tag | undefined {
    const row = selectTagByIdStmt.get(id, userId) as TagRow | undefined;
    return row ? mapTag(row) : undefined;
  },

  listByTodo(todoId: number, userId: number): Tag[] {
    ensureTodoRow(todoId, userId);
    return listTagsForTodoInternal(todoId, userId);
  },

  create(userId: number, input: { name: string; color: string; description?: string | null }): Tag {
    const now = singaporeUtcIso();
    const name = normalizeName(input.name);
    const color = input.color.trim().toUpperCase();
    const description = normalizeDescription(input.description ?? null);

    const result = insertTagStmt.run(userId, name, color, description, now, now);
    const row = selectTagByIdStmt.get(result.lastInsertRowid as number, userId);
    if (!row) {
      throw new Error('Failed to create tag');
    }
    return mapTag(row);
  },

  update(id: number, userId: number, input: { name?: string; color?: string; description?: string | null }): Tag {
    ensureTagRow(id, userId);
    const now = singaporeUtcIso();

    updateTagStmt.run({
      id,
      user_id: userId,
      name: input.name ? normalizeName(input.name) : null,
      color: input.color ? input.color.trim().toUpperCase() : null,
      description: input.description === null ? '__NULL__' : normalizeDescription(input.description ?? undefined),
      updated_at: now
    });

    const row = selectTagByIdStmt.get(id, userId);
    if (!row) {
      throw new Error('Tag not found after update');
    }
    return mapTag(row as TagRow);
  },

  delete(id: number, userId: number): void {
    ensureTagRow(id, userId);
    deleteTagStmt.run(id, userId);
  },

  attachTag(todoId: number, tagId: number, userId: number): Tag[] {
    ensureTodoRow(todoId, userId);
    ensureTagRow(tagId, userId);
    attachTagStmt.run(todoId, tagId);
    return listTagsForTodoInternal(todoId, userId);
  },

  attachMany(todoId: number, tagIds: number[], userId: number): Tag[] {
    if (tagIds.length === 0) {
      return listTagsForTodoInternal(todoId, userId);
    }

    ensureTodoRow(todoId, userId);
    const apply = db.transaction((ids: number[]) => {
      for (const tagId of ids) {
        ensureTagRow(tagId, userId);
        attachTagStmt.run(todoId, tagId);
      }
    });

    apply(tagIds);
    return listTagsForTodoInternal(todoId, userId);
  },

  detachTag(todoId: number, tagId: number, userId: number): Tag[] {
    ensureTodoRow(todoId, userId);
    ensureTagRow(tagId, userId);
    detachTagStmt.run(todoId, tagId);
    return listTagsForTodoInternal(todoId, userId);
  },

  ensureOwned(userId: number, tagIds: number[]): Tag[] {
    if (tagIds.length === 0) {
      return [];
    }

    const rows: TagRow[] = [];
    for (const tagId of tagIds) {
      const row = selectTagByIdStmt.get(tagId, userId) as TagRow | undefined;
      if (!row) {
        throw new Error('Tag not found');
      }
      rows.push(row);
    }
    return rows.map(mapTag);
  }
};

export { db };
