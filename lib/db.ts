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
  const columnInfo = db.prepare<{ name: string }>(`PRAGMA table_info('todos')`).all();
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

export type Priority = 'high' | 'medium' | 'low';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

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

function mapTodo(row: TodoRow): Todo {
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

    return mapTodo(row);
  },

  listByUser(userId: number): Todo[] {
    const rows = selectTodos.all(userId) as TodoRow[];
    return rows.map(mapTodo);
  },

  listReminderCandidates(userId: number): Todo[] {
    const rows = selectReminderCandidates.all(userId) as TodoRow[];
    return rows.map(mapTodo);
  },

  getById(id: number, userId: number): Todo | undefined {
    const row = selectTodoById.get(id, userId) as TodoRow | undefined;
    return row ? mapTodo(row) : undefined;
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

    return mapTodo(row);
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

    return mapTodo(row);
  }
};

export { db };
