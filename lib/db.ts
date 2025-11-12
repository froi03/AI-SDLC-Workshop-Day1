import Database from 'better-sqlite3';
import path from 'node:path';
import { getSingaporeNow, serializeSingaporeDate } from './timezone';

export type Priority = 'high' | 'medium' | 'low';

export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Todo {
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
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: Priority;
  recurrencePattern?: RecurrencePattern | null;
  reminderMinutes?: number | null;
}

export interface UpdateTodoInput extends Partial<CreateTodoInput> {
  isCompleted?: boolean;
  completedAt?: string | null;
}

export interface SubtaskStats {
  total: number;
  completed: number;
}

export interface TodoWithRelations extends Todo {
  subtaskStats: SubtaskStats;
  tagIds: number[];
}

const DEFAULT_USER_ID = 1;

const dbPath = path.join(process.cwd(), 'todos.db');

const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      is_completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      recurrence_pattern TEXT,
      reminder_minutes INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_user_due ON todos(user_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_todos_user_completed ON todos(user_id, is_completed);

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, name),
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

  const countUsers = db.prepare('SELECT COUNT(1) as count FROM users').get() as { count: number };
  if (countUsers.count === 0) {
    const nowIso = serializeSingaporeDate(getSingaporeNow());
    db.prepare(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)' // deterministic default user
    ).run(DEFAULT_USER_ID, 'demo', nowIso, nowIso);
  }
}

ensureSchema();

function mapTodo(row: any): Todo {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    isCompleted: Boolean(row.is_completed),
    completedAt: row.completed_at,
    priority: row.priority as Priority,
    recurrencePattern: (row.recurrence_pattern as RecurrencePattern | null) ?? null,
    reminderMinutes: row.reminder_minutes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const selectTodoById = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?');
const listTodosByUserStmt = db.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC');
const insertTodoStmt = db.prepare(`
  INSERT INTO todos (
    user_id,
    title,
    description,
    due_date,
    is_completed,
    completed_at,
    priority,
    recurrence_pattern,
    reminder_minutes,
    created_at,
    updated_at
  ) VALUES (
    @userId,
    @title,
    @description,
    @dueDate,
    @isCompleted,
    @completedAt,
    @priority,
    @recurrencePattern,
    @reminderMinutes,
    @createdAt,
    @updatedAt
  )
`);

const updateTodoStmt = db.prepare(`
  UPDATE todos
  SET
    title = coalesce(@title, title),
    description = coalesce(@description, description),
    due_date = @dueDate,
    is_completed = coalesce(@isCompleted, is_completed),
    completed_at = @completedAt,
    priority = coalesce(@priority, priority),
    recurrence_pattern = @recurrencePattern,
    reminder_minutes = @reminderMinutes,
    updated_at = @updatedAt
  WHERE id = @id AND user_id = @userId
`);

const deleteTodoStmt = db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?');

const subtaskStatsStmt = db.prepare(`
  SELECT
    COUNT(1) AS total,
    SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed
  FROM subtasks
  WHERE todo_id = ?
`);

const tagIdsStmt = db.prepare('SELECT tag_id FROM todo_tags WHERE todo_id = ?');

function buildTodoWithRelations(todo: Todo): TodoWithRelations {
  const statsRow = subtaskStatsStmt.get(todo.id) as { total: number | null; completed: number | null } | undefined;
  const tagsRows = tagIdsStmt.all(todo.id) as Array<{ tag_id: number }>;
  return {
    ...todo,
    subtaskStats: {
      total: statsRow?.total ?? 0,
      completed: statsRow?.completed ?? 0
    },
    tagIds: tagsRows.map((row) => row.tag_id)
  };
}

function findById(id: number, userId: number): TodoWithRelations | undefined {
  const row = selectTodoById.get(id, userId);
  if (!row) return undefined;
  return buildTodoWithRelations(mapTodo(row));
}

export const todoDB = {
  listByUser(userId: number): TodoWithRelations[] {
    const rows = listTodosByUserStmt.all(userId) as any[];
    return rows.map((row) => buildTodoWithRelations(mapTodo(row)));
  },

  findById,

  create(userId: number, input: CreateTodoInput): TodoWithRelations {
    const now = serializeSingaporeDate(getSingaporeNow());
    const runResult = insertTodoStmt.run({
      userId,
      title: input.title,
      description: input.description ?? '',
      dueDate: input.dueDate ?? null,
      isCompleted: 0,
      completedAt: null,
      priority: input.priority ?? 'medium',
      recurrencePattern: input.recurrencePattern ?? null,
      reminderMinutes: input.reminderMinutes ?? null,
      createdAt: now,
      updatedAt: now
    });

    const created = findById(runResult.lastInsertRowid as number, userId);
    if (!created) {
      throw new Error('Failed to fetch created todo');
    }
    return created;
  },

  update(id: number, userId: number, patch: UpdateTodoInput): TodoWithRelations {
    const now = serializeSingaporeDate(getSingaporeNow());
    updateTodoStmt.run({
      id,
      userId,
      title: patch.title,
      description: patch.description,
      dueDate: patch.dueDate ?? null,
      isCompleted: typeof patch.isCompleted === 'boolean' ? Number(patch.isCompleted) : undefined,
      completedAt: patch.completedAt ?? null,
      priority: patch.priority,
      recurrencePattern: patch.recurrencePattern ?? null,
      reminderMinutes: patch.reminderMinutes ?? null,
      updatedAt: now
    });

    const updated = findById(id, userId);
    if (!updated) {
      throw new Error('Todo not found');
    }
    return updated;
  },

  delete(id: number, userId: number): void {
    deleteTodoStmt.run(id, userId);
  }
};

export function getDefaultUserId(): number {
  return DEFAULT_USER_ID;
}
