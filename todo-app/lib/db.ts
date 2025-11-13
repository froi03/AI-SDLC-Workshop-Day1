import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { getSingaporeNow, isFutureSingaporeDate, parseSingaporeDate } from './timezone';

const DB_FILENAME = 'todos.db';
const dbPath = path.join(process.cwd(), DB_FILENAME);

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, '');
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

export const EXPORT_VERSION = '1.0';
const REMINDER_OPTIONS = new Set([15, 30, 60, 120, 1440, 2880, 10080]);
const TEMPLATE_NAME_MAX_LENGTH = 80;
const TEMPLATE_CATEGORY_MAX_LENGTH = 40;
const TEMPLATE_DESCRIPTION_MAX_LENGTH = 500;
const TEMPLATE_TODO_TITLE_MAX_LENGTH = 200;
const TEMPLATE_TODO_DESCRIPTION_MAX_LENGTH = 2000;
const FALLBACK_TAG_COLOR = '#3B82F6';

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    display_name TEXT,
    current_challenge TEXT,
    current_challenge_expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

ensureUserTable();
ensureAuthenticatorTables();
ensureTodoConstraints();
ensureTagTables();
ensureSubtaskTables();
ensureTemplateTables();
ensureHolidayTables();

const ensureDefaultUser = db.prepare(`
  INSERT INTO users (id, email, display_name, created_at, updated_at)
  SELECT 1, 'demo@example.com', 'Demo User', @now, @now
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1)
`);

ensureDefaultUser.run({ now: singaporeUtcIso() });

function ensureUserTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      display_name TEXT,
      current_challenge TEXT,
      current_challenge_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const columns = db.prepare<{ name: string }>(`PRAGMA table_info('users')`).all() as { name: string }[];
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('display_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  }
  if (!columnNames.has('current_challenge')) {
    db.exec(`ALTER TABLE users ADD COLUMN current_challenge TEXT`);
  }
  if (!columnNames.has('current_challenge_expires_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN current_challenge_expires_at TEXT`);
  }
  if (!columnNames.has('created_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN created_at TEXT`);
  }
  if (!columnNames.has('updated_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN updated_at TEXT`);
  }

  const nowIso = singaporeUtcIso();
  db.prepare(`
    UPDATE users
    SET created_at = COALESCE(created_at, @now),
        updated_at = COALESCE(updated_at, @now)
    WHERE created_at IS NULL OR updated_at IS NULL
  `).run({ now: nowIso });

  db.exec(`UPDATE users SET email = LOWER(TRIM(email)) WHERE email IS NOT NULL`);
  db.exec(`UPDATE users SET display_name = TRIM(display_name) WHERE display_name IS NOT NULL`);
  db.exec(`UPDATE users SET display_name = email WHERE (display_name IS NULL OR display_name = '') AND email IS NOT NULL`);
}

function ensureAuthenticatorTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_authenticators_user ON authenticators(user_id);
  `);
}

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

function ensureSubtaskTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_position ON subtasks(todo_id, position);
  `);
}

function ensureTemplateTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      description TEXT,
      category TEXT,
  todo_title TEXT NOT NULL,
  todo_description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
      recurrence_pattern TEXT CHECK (recurrence_pattern IN ('daily','weekly','monthly','yearly')),
      reminder_minutes INTEGER,
      due_offset_days INTEGER NOT NULL DEFAULT 0 CHECK (due_offset_days >= 0),
      tags TEXT NOT NULL DEFAULT '[]',
      subtasks TEXT NOT NULL DEFAULT '[]',
      estimated_duration_minutes INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
    CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(user_id, category);
  `);
}

function ensureHolidayTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
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

export interface Subtask {
  id: number;
  todoId: number;
  title: string;
  position: number;
  isCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProgressStats = {
  completed: number;
  total: number;
  percent: number;
};

export type TemplateSubtaskDefinition = {
  title: string;
  position: number;
};

export interface Template {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  category: string | null;
  todoTitle: string;
  todoDescription: string;
  priority: Priority;
  recurrencePattern: RecurrencePattern | null;
  reminderMinutes: number | null;
  dueOffsetDays: number;
  tagIds: number[];
  subtasks: TemplateSubtaskDefinition[];
  estimatedDurationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSummary extends Template {
  usageCount: number;
}

export interface TemplateInput {
  name: string;
  description?: string | null;
  category?: string | null;
  todoTitle: string;
  todoDescription?: string;
  priority: Priority;
  recurrencePattern?: RecurrencePattern | null;
  reminderMinutes?: number | null;
  dueOffsetDays?: number;
  tagIds?: number[];
  subtasks?: TemplateSubtaskDefinition[];
  estimatedDurationMinutes?: number | null;
}

export interface ExportedTodoRecord {
  id: number;
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

export interface ExportedTagRecord {
  id: number;
  name: string;
  color: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportedSubtaskRecord {
  id: number;
  todoId: number;
  title: string;
  position: number;
  isCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExportedTodoTagRecord {
  todoId: number;
  tagId: number;
}

export interface TodosExportPayload {
  version: string;
  generatedAt: string;
  todos: ExportedTodoRecord[];
  subtasks: ExportedSubtaskRecord[];
  tags: ExportedTagRecord[];
  todoTags: ExportedTodoTagRecord[];
}

export interface TodoImportResult {
  createdTodoIds: number[];
  createdSubtaskIds: number[];
  createdTagIds: number[];
}

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
  subtasks: Subtask[];
  progress: ProgressStats;
  createdAt: string;
  updatedAt: string;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  email: string;
  displayName: string;
  currentChallenge: string | null;
  currentChallengeExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Authenticator {
  id: number;
  userId: number;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  createdAt: string;
  updatedAt: string;
}

type UserRow = {
  id: number;
  email: string;
  display_name: string | null;
  current_challenge: string | null;
  current_challenge_expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AuthenticatorRow = {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number | null;
  transports: string;
  created_at: string;
  updated_at: string;
};

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

type HolidayRow = {
  id: number;
  date: string;
  name: string;
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

type SubtaskRow = {
  id: number;
  todo_id: number;
  title: string;
  position: number;
  is_completed: 0 | 1;
  created_at: string;
  updated_at: string;
};

type SubtaskJoinRow = SubtaskRow & { user_id: number };

type TemplateRow = {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  category: string | null;
  todo_title: string;
  todo_description: string;
  priority: Priority;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  due_offset_days: number;
  tags: string;
  subtasks: string;
  estimated_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
};

const insertUserStmt = db.prepare(`
  INSERT INTO users (
    email,
    display_name,
    current_challenge,
    current_challenge_expires_at,
    created_at,
    updated_at
  ) VALUES (?, ?, NULL, NULL, ?, ?)
`);

const selectUserByEmailStmt = db.prepare<UserRow | undefined>(
  `SELECT * FROM users WHERE email = ? COLLATE NOCASE`
);

const selectUserByIdStmt = db.prepare<UserRow | undefined>(`SELECT * FROM users WHERE id = ?`);

const updateUserChallengeStmt = db.prepare(`
  UPDATE users
  SET current_challenge = ?, current_challenge_expires_at = ?, updated_at = ?
  WHERE id = ?
`);

const clearUserChallengeStmt = db.prepare(`
  UPDATE users
  SET current_challenge = NULL,
      current_challenge_expires_at = NULL,
      updated_at = ?
  WHERE id = ?
`);

const selectAuthenticatorsByUserStmt = db.prepare<AuthenticatorRow[]>(
  `SELECT * FROM authenticators WHERE user_id = ? ORDER BY id ASC`
);

const selectAuthenticatorByCredentialStmt = db.prepare<AuthenticatorRow | undefined>(
  `SELECT * FROM authenticators WHERE credential_id = ? AND user_id = ?`
);

const upsertAuthenticatorStmt = db.prepare(`
  INSERT INTO authenticators (
    user_id,
    credential_id,
    public_key,
    counter,
    transports,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(credential_id) DO UPDATE SET
    user_id = excluded.user_id,
    public_key = excluded.public_key,
    counter = excluded.counter,
    transports = excluded.transports,
    updated_at = excluded.updated_at
`);

const updateAuthenticatorCounterStmt = db.prepare(`
  UPDATE authenticators
  SET counter = ?, updated_at = ?
  WHERE id = ?
`);

function normalizeUserEmail(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim().toLowerCase();
}

function normalizeUserDisplayName(input: string | null | undefined): string {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

export const userDB = {
  create(input: { email: string; displayName: string }): User {
    const email = normalizeUserEmail(input.email);
    if (!email) {
      throw new Error('Email is required');
    }

    const displayNameRaw = normalizeUserDisplayName(input.displayName);
    const displayName = displayNameRaw || email;
    const now = singaporeUtcIso();
    const result = insertUserStmt.run(email, displayName, now, now);
    const createdId = Number(result.lastInsertRowid);
    const createdRow = selectUserByIdStmt.get(createdId) as UserRow | undefined;
    if (!createdRow) {
      throw new Error('Failed to create user');
    }
    return mapUser(createdRow);
  },

  findByEmail(email: string): User | null {
    const normalized = normalizeUserEmail(email);
    if (!normalized) {
      return null;
    }
    const row = selectUserByEmailStmt.get(normalized) as UserRow | undefined;
    return row ? mapUser(row) : null;
  },

  getById(id: number): User | null {
    const row = selectUserByIdStmt.get(id) as UserRow | undefined;
    return row ? mapUser(row) : null;
  },

  setChallenge(userId: number, challenge: string, expiresAt: string | null): void {
    const now = singaporeUtcIso();
    updateUserChallengeStmt.run(challenge, expiresAt, now, userId);
  },

  clearChallenge(userId: number): void {
    const now = singaporeUtcIso();
    clearUserChallengeStmt.run(now, userId);
  }
};

export const authenticatorDB = {
  listByUser(userId: number): Authenticator[] {
    const rows = selectAuthenticatorsByUserStmt.all(userId) as AuthenticatorRow[];
    return rows.map(mapAuthenticator);
  },

  findByCredentialId(userId: number, credentialId: string): Authenticator | null {
    const row = selectAuthenticatorByCredentialStmt.get(credentialId, userId) as AuthenticatorRow | undefined;
    return row ? mapAuthenticator(row) : null;
  },

  upsert(input: { userId: number; credentialId: string; publicKey: string; counter: number; transports: string[] }): Authenticator {
    const now = singaporeUtcIso();
    const transports = Array.isArray(input.transports)
      ? input.transports.filter((value): value is string => typeof value === 'string')
      : [];
    const transportsJson = JSON.stringify(Array.from(new Set(transports)));

    upsertAuthenticatorStmt.run(
      input.userId,
      input.credentialId,
      input.publicKey,
      input.counter ?? 0,
      transportsJson,
      now,
      now
    );

    const row = selectAuthenticatorByCredentialStmt.get(input.credentialId, input.userId) as AuthenticatorRow | undefined;
    if (!row) {
      throw new Error('Failed to persist authenticator');
    }
    return mapAuthenticator(row);
  },

  updateCounter(id: number, counter: number): void {
    const now = singaporeUtcIso();
    updateAuthenticatorCounterStmt.run(counter ?? 0, now, id);
  }
};

function mapUser(row: UserRow): User {
  const fallbackTimestamp = singaporeUtcIso();
  const createdAt = row.created_at ?? fallbackTimestamp;
  const updatedAt = row.updated_at ?? createdAt;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? row.email,
    currentChallenge: row.current_challenge ?? null,
    currentChallengeExpiresAt: row.current_challenge_expires_at ?? null,
    createdAt,
    updatedAt
  };
}

function mapAuthenticator(row: AuthenticatorRow): Authenticator {
  let transports: string[] = [];
  if (row.transports) {
    try {
      const parsed = JSON.parse(row.transports);
      if (Array.isArray(parsed)) {
        transports = parsed.filter((value): value is string => typeof value === 'string');
      }
    } catch (error) {
      console.error('Failed to parse authenticator transports', error);
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: row.counter ?? 0,
    transports,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

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

function mapSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    todoId: row.todo_id,
    title: row.title,
    position: row.position,
    isCompleted: Boolean(row.is_completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseTemplateTagIds(raw: string): number[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const ids = parsed
      .map((value) => {
        const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
        return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
      })
      .filter((value): value is number => value != null);

    return Array.from(new Set(ids));
  } catch (error) {
    console.error('Failed to parse template tag ids', error);
    return [];
  }
}

function parseTemplateSubtasks(raw: string): TemplateSubtaskDefinition[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const collected: TemplateSubtaskDefinition[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const title = typeof entry.title === 'string' ? entry.title.trim() : '';
      const positionValue = typeof entry.position === 'number' ? entry.position : Number.parseInt(String(entry.position ?? 0), 10);
      if (!title) {
        continue;
      }

      const normalizedPosition = Number.isInteger(positionValue) && positionValue > 0 ? positionValue : collected.length + 1;
      collected.push({ title, position: normalizedPosition });
    }

    collected.sort((a, b) => a.position - b.position);
    return collected.map((entry, index) => ({ title: entry.title, position: index + 1 }));
  } catch (error) {
    console.error('Failed to parse template subtasks', error);
    return [];
  }
}

function mapTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    category: row.category,
    todoTitle: row.todo_title,
    todoDescription: row.todo_description,
    priority: row.priority,
    recurrencePattern: row.recurrence_pattern,
    reminderMinutes: row.reminder_minutes,
    dueOffsetDays: row.due_offset_days,
    tagIds: parseTemplateTagIds(row.tags),
    subtasks: parseTemplateSubtasks(row.subtasks),
    estimatedDurationMinutes: row.estimated_duration_minutes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function calculateProgressStats(subtasks: Subtask[]): ProgressStats {
  const total = subtasks.length;
  if (total === 0) {
    return { completed: 0, total: 0, percent: 0 };
  }
  const completed = subtasks.reduce((count, subtask) => (subtask.isCompleted ? count + 1 : count), 0);
  const percent = Math.round((completed / total) * 100);
  return { completed, total, percent };
}

function mapTodo(row: TodoRow, tags: Tag[] = [], subtasks: Subtask[] = []): Todo {
  const progress = calculateProgressStats(subtasks);
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
    subtasks,
    progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapHoliday(row: HolidayRow): Holiday {
  return {
    id: row.id,
    date: row.date,
    name: row.name,
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

function collectSubtasksForTodos(userId: number, todoIds: number[]): Map<number, Subtask[]> {
  const map = new Map<number, Subtask[]>();
  if (todoIds.length === 0) {
    return map;
  }

  const idSet = new Set(todoIds);
  const rows = selectSubtasksForUserStmt.all(userId) as SubtaskRow[];
  for (const row of rows) {
    if (!idSet.has(row.todo_id)) {
      continue;
    }
    const subtask = mapSubtask(row);
    const existing = map.get(row.todo_id);
    if (existing) {
      existing.push(subtask);
    } else {
      map.set(row.todo_id, [subtask]);
    }
  }

  return map;
}

function listSubtasksForTodoInternal(todoId: number, userId: number): Subtask[] {
  ensureTodoRow(todoId, userId);
  const rows = selectSubtasksByTodoStmt.all(todoId) as SubtaskRow[];
  return rows.map(mapSubtask);
}

function calculateProgressForTodo(todoId: number, userId: number): ProgressStats {
  const stats = selectProgressForTodoStmt.get(todoId, userId) as { total: number; completed: number } | undefined;
  if (!stats) {
    return { completed: 0, total: 0, percent: 0 };
  }
  const total = stats.total ?? 0;
  const completed = stats.completed ?? 0;
  if (total === 0) {
    return { completed: 0, total: 0, percent: 0 };
  }
  const percent = Math.round((completed / total) * 100);
  return { completed, total, percent };
}

function ensureTodoRow(id: number, userId: number): TodoRow {
  const row = selectTodoById.get(id, userId) as TodoRow | undefined;
  if (!row) {
    throw new Error('Todo not found');
  }
  return row;
}

function ensureTemplateRow(id: number, userId: number): TemplateRow {
  const row = selectTemplateByIdStmt.get(id, userId) as TemplateRow | undefined;
  if (!row) {
    throw new Error('Template not found');
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

const selectTodosInDueRangeStmt = db.prepare<TodoRow[]>(`
  SELECT *
  FROM todos
  WHERE user_id = ?
    AND due_date IS NOT NULL
    AND due_date >= ?
    AND due_date < ?
  ORDER BY due_date ASC, id ASC
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

const selectSubtasksByTodoStmt = db.prepare<SubtaskRow[]>(`
  SELECT id, todo_id, title, position, is_completed, created_at, updated_at
  FROM subtasks
  WHERE todo_id = ?
  ORDER BY position ASC, id ASC
`);

const selectSubtasksForUserStmt = db.prepare<SubtaskRow[]>(`
  SELECT
    s.id,
    s.todo_id,
    s.title,
    s.position,
    s.is_completed,
    s.created_at,
    s.updated_at
  FROM subtasks s
  INNER JOIN todos t ON t.id = s.todo_id
  WHERE t.user_id = ?
  ORDER BY s.todo_id ASC, s.position ASC, s.id ASC
`);

const selectProgressForTodoStmt = db.prepare<{ total: number; completed: number }>(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN s.is_completed = 1 THEN 1 ELSE 0 END) AS completed
  FROM subtasks s
  INNER JOIN todos t ON t.id = s.todo_id
  WHERE s.todo_id = ? AND t.user_id = ?
`);

const selectSubtaskByIdWithUserStmt = db.prepare<SubtaskJoinRow | undefined>(`
  SELECT
    s.id,
    s.todo_id,
    s.title,
    s.position,
    s.is_completed,
    s.created_at,
    s.updated_at,
    t.user_id
  FROM subtasks s
  INNER JOIN todos t ON t.id = s.todo_id
  WHERE s.id = ?
`);

const insertSubtaskStmt = db.prepare(`
  INSERT INTO subtasks (todo_id, title, position, is_completed, created_at, updated_at)
  VALUES (?, ?, ?, 0, ?, ?)
`);

const insertImportedSubtaskStmt = db.prepare(`
  INSERT INTO subtasks (todo_id, title, position, is_completed, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const updateSubtaskTitleStmt = db.prepare(`
  UPDATE subtasks
  SET title = ?, updated_at = ?
  WHERE id = ?
`);

const toggleSubtaskCompletionStmt = db.prepare(`
  UPDATE subtasks
  SET is_completed = ?, updated_at = ?
  WHERE id = ?
`);

const updateSubtaskPositionStmt = db.prepare(`
  UPDATE subtasks
  SET position = ?, updated_at = ?
  WHERE id = ?
`);

const deleteSubtaskStmt = db.prepare(`DELETE FROM subtasks WHERE id = ?`);

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

const upsertHolidayStmt = db.prepare(`
  INSERT INTO holidays (date, name, created_at, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET
    name = excluded.name,
    updated_at = excluded.updated_at
`);

const selectAllHolidaysStmt = db.prepare<HolidayRow[]>(
  `SELECT id, date, name, created_at, updated_at FROM holidays ORDER BY date ASC`
);

const selectHolidaysInRangeStmt = db.prepare<HolidayRow[]>(
  `SELECT id, date, name, created_at, updated_at FROM holidays WHERE date >= ? AND date < ? ORDER BY date ASC`
);

const selectTemplatesByUserStmt = db.prepare<TemplateRow[]>(`
  SELECT
    id,
    user_id,
    name,
    description,
    category,
    todo_title,
    todo_description,
    priority,
    recurrence_pattern,
    reminder_minutes,
    due_offset_days,
    tags,
    subtasks,
    estimated_duration_minutes,
    created_at,
    updated_at
  FROM templates
  WHERE user_id = ?
  ORDER BY
    CASE WHEN category IS NULL OR category = '' THEN 1 ELSE 0 END,
    LOWER(COALESCE(category, '')) ASC,
    name COLLATE NOCASE ASC
`);

const selectTemplateByIdStmt = db.prepare<TemplateRow | undefined>(
  `SELECT * FROM templates WHERE id = ? AND user_id = ?`
);

const selectTemplateByNameStmt = db.prepare<TemplateRow | undefined>(
  `SELECT * FROM templates WHERE user_id = ? AND name = ? COLLATE NOCASE`
);

const insertTemplateStmt = db.prepare(`
  INSERT INTO templates (
    user_id,
    name,
    description,
    category,
    todo_title,
    todo_description,
    priority,
    recurrence_pattern,
    reminder_minutes,
    due_offset_days,
    tags,
    subtasks,
    estimated_duration_minutes,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTemplateStmt = db.prepare(`
  UPDATE templates
  SET
    name = COALESCE(@name, name),
    description = CASE WHEN @description = '__NULL__' THEN NULL ELSE COALESCE(@description, description) END,
    category = CASE WHEN @category = '__NULL__' THEN NULL ELSE COALESCE(@category, category) END,
  todo_title = COALESCE(@todo_title, todo_title),
  todo_description = CASE WHEN @todo_description = '__NULL__' THEN '' ELSE COALESCE(@todo_description, todo_description) END,
    priority = COALESCE(@priority, priority),
    recurrence_pattern = CASE WHEN @recurrence_pattern = '__NULL__' THEN NULL ELSE COALESCE(@recurrence_pattern, recurrence_pattern) END,
    reminder_minutes = CASE WHEN @reminder_minutes = '__NULL__' THEN NULL ELSE COALESCE(@reminder_minutes, reminder_minutes) END,
    due_offset_days = COALESCE(@due_offset_days, due_offset_days),
    tags = COALESCE(@tags, tags),
    subtasks = COALESCE(@subtasks, subtasks),
    estimated_duration_minutes = CASE WHEN @estimated_duration_minutes = '__NULL__' THEN NULL ELSE COALESCE(@estimated_duration_minutes, estimated_duration_minutes) END,
    updated_at = @updated_at
  WHERE id = @id AND user_id = @user_id
`);

const deleteTemplateStmt = db.prepare(`DELETE FROM templates WHERE id = ? AND user_id = ?`);

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

    return mapTodo(row, [], []);
  },

  listByUser(userId: number): Todo[] {
    const rows = selectTodos.all(userId) as TodoRow[];
    const tagMap = collectTagsForTodos(userId, rows.map((row) => row.id));
    const subtaskMap = collectSubtasksForTodos(userId, rows.map((row) => row.id));
    return rows.map((row) => mapTodo(row, tagMap.get(row.id) ?? [], subtaskMap.get(row.id) ?? []));
  },

  listByDueDateRange(userId: number, startIso: string, endIso: string): Todo[] {
    if (!startIso || !endIso) {
      return [];
    }

    const rows = selectTodosInDueRangeStmt.all(userId, startIso, endIso) as TodoRow[];
    if (rows.length === 0) {
      return [];
    }

    const todoIds = rows.map((row) => row.id);
    const tagMap = collectTagsForTodos(userId, todoIds);
    const subtaskMap = collectSubtasksForTodos(userId, todoIds);
    return rows.map((row) => mapTodo(row, tagMap.get(row.id) ?? [], subtaskMap.get(row.id) ?? []));
  },

  listReminderCandidates(userId: number): Todo[] {
    const rows = selectReminderCandidates.all(userId) as TodoRow[];
    const todoIds = rows.map((row) => row.id);
    const tagMap = collectTagsForTodos(userId, todoIds);
    const subtaskMap = collectSubtasksForTodos(userId, todoIds);
    return rows.map((row) => mapTodo(row, tagMap.get(row.id) ?? [], subtaskMap.get(row.id) ?? []));
  },

  getById(id: number, userId: number): Todo | undefined {
    const row = selectTodoById.get(id, userId) as TodoRow | undefined;
    if (!row) {
      return undefined;
    }
    const tags = listTagsForTodoInternal(id, userId);
    const subtasks = listSubtasksForTodoInternal(id, userId);
    return mapTodo(row, tags, subtasks);
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
    const subtasks = listSubtasksForTodoInternal(id, userId);
    return mapTodo(row, tags, subtasks);
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
    const subtasks = listSubtasksForTodoInternal(id, userId);
    return mapTodo(row, tags, subtasks);
  },

  exportData(userId: number): TodosExportPayload {
    const todoRows = selectTodos.all(userId) as TodoRow[];
    const tagRows = selectTagsByUserStmt.all(userId) as TagRow[];
    const subtaskRows = selectSubtasksForUserStmt.all(userId) as SubtaskRow[];
    const todoTagRows = selectTodoTagsByUserStmt.all(userId) as TodoTagRow[];

    const todos: ExportedTodoRecord[] = todoRows.map((row) => ({
      id: row.id,
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
    }));

    const tags: ExportedTagRecord[] = tagRows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const subtasks: ExportedSubtaskRecord[] = subtaskRows.map((row) => ({
      id: row.id,
      todoId: row.todo_id,
      title: row.title,
      position: row.position,
      isCompleted: Boolean(row.is_completed),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const todoTags: ExportedTodoTagRecord[] = todoTagRows.map((row) => ({
      todoId: row.todo_id,
      tagId: row.id
    }));

    const generated = getSingaporeNow().toUTC().toISO();
    if (!generated) {
      throw new Error('Failed to generate export timestamp');
    }

    return {
      version: EXPORT_VERSION,
      generatedAt: generated,
      todos,
      subtasks,
      tags,
      todoTags
    };
  },

  importData(userId: number, payload: TodosExportPayload): TodoImportResult {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid import payload');
    }

    if (payload.version !== EXPORT_VERSION) {
      throw new Error('Unsupported export version');
    }

    const tagsInput = Array.isArray(payload.tags) ? payload.tags : [];
    const todosInput = Array.isArray(payload.todos) ? payload.todos : [];
    const subtasksInput = Array.isArray(payload.subtasks) ? payload.subtasks : [];
    const todoTagsInput = Array.isArray(payload.todoTags) ? payload.todoTags : [];

    const transaction = db.transaction(() => {
      const createdTodoIds: number[] = [];
      const createdSubtaskIds: number[] = [];
      const createdTagIds: number[] = [];

      const tagIdMap = new Map<number, number>();
      const todoIdMap = new Map<number, number>();

      const existingTags = selectTagsByUserStmt.all(userId) as TagRow[];
      const tagsByName = new Map<string, TagRow>();
      for (const tag of existingTags) {
        tagsByName.set(tag.name.toLowerCase(), tag);
      }

      const nowIso = singaporeUtcIso();

      for (const rawTag of tagsInput) {
        if (!rawTag || typeof rawTag !== 'object') {
          continue;
        }

        const rawId = (rawTag as { id?: unknown }).id;
        const originalId = typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId ?? 0), 10);
        if (!Number.isInteger(originalId) || originalId <= 0) {
          continue;
        }

        const nameSource = (rawTag as { name?: unknown }).name;
        let normalizedName: string;
        try {
          normalizedName = normalizeName(typeof nameSource === 'string' ? nameSource : '');
        } catch {
          continue;
        }

        const lookupKey = normalizedName.toLowerCase();
        const existing = tagsByName.get(lookupKey);
        if (existing) {
          tagIdMap.set(originalId, existing.id);
          continue;
        }

        const color = sanitizeTagColor((rawTag as { color?: unknown }).color);
        const description = normalizeDescription((rawTag as { description?: unknown }).description as string | null | undefined);
        const createdAt = isoOrFallback((rawTag as { createdAt?: unknown }).createdAt, nowIso);
        const updatedAt = isoOrFallback((rawTag as { updatedAt?: unknown }).updatedAt, createdAt);

        const result = insertTagStmt.run(userId, normalizedName, color, description, createdAt, updatedAt);
        const newId = result.lastInsertRowid as number;
        tagIdMap.set(originalId, newId);
        createdTagIds.push(newId);
        tagsByName.set(lookupKey, {
          id: newId,
          user_id: userId,
          name: normalizedName,
          color,
          description,
          created_at: createdAt,
          updated_at: updatedAt
        });
      }

      for (const rawTodo of todosInput) {
        if (!rawTodo || typeof rawTodo !== 'object') {
          continue;
        }

        const rawId = (rawTodo as { id?: unknown }).id;
        const originalId = typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId ?? 0), 10);
        if (!Number.isInteger(originalId) || originalId <= 0) {
          continue;
        }

        const titleSource = (rawTodo as { title?: unknown }).title;
        const title = typeof titleSource === 'string' ? titleSource.trim() : '';
        if (!title) {
          continue;
        }

        const descriptionSource = (rawTodo as { description?: unknown }).description;
        const description = typeof descriptionSource === 'string' ? descriptionSource : '';

        const priority = coercePriority((rawTodo as { priority?: unknown }).priority);
        const dueDate = toUtcIso((rawTodo as { dueDate?: unknown }).dueDate) ?? null;
        const isRecurring = Boolean((rawTodo as { isRecurring?: unknown }).isRecurring);
        let recurrencePattern = coerceRecurrencePattern((rawTodo as { recurrencePattern?: unknown }).recurrencePattern);
        if (!isRecurring) {
          recurrencePattern = null;
        }
        const reminderMinutes = coerceReminderMinutes((rawTodo as { reminderMinutes?: unknown }).reminderMinutes);
        const isCompleted = Boolean((rawTodo as { isCompleted?: unknown }).isCompleted);
        const completedAtIso = toUtcIso((rawTodo as { completedAt?: unknown }).completedAt);
        const lastNotificationIso = toUtcIso((rawTodo as { lastNotificationSent?: unknown }).lastNotificationSent);
        const createdAt = isoOrFallback((rawTodo as { createdAt?: unknown }).createdAt, nowIso);
        const updatedAt = isoOrFallback((rawTodo as { updatedAt?: unknown }).updatedAt, createdAt);

        const insertResult = insertTodo.run(
          userId,
          title,
          description,
          priority,
          dueDate,
          isRecurring ? 1 : 0,
          recurrencePattern,
          reminderMinutes,
          lastNotificationIso,
          createdAt,
          updatedAt
        );

        const newId = insertResult.lastInsertRowid as number;
        todoIdMap.set(originalId, newId);
        createdTodoIds.push(newId);

        const completedParam = isCompleted ? completedAtIso ?? '__NULL__' : '__NULL__';
        updateTodoStmt.run({
          id: newId,
          user_id: userId,
          title: null,
          description: null,
          priority: null,
          due_date: null,
          is_completed: isCompleted ? 1 : 0,
          completed_at: completedParam,
          is_recurring: null,
          recurrence_pattern: null,
          reminder_minutes: null,
          last_notification_sent: lastNotificationIso === null ? '__NULL__' : lastNotificationIso,
          updated_at: updatedAt
        });
      }

      for (const rawSubtask of subtasksInput) {
        if (!rawSubtask || typeof rawSubtask !== 'object') {
          continue;
        }

        const todoSource = (rawSubtask as { todoId?: unknown }).todoId;
        const originalTodoId = typeof todoSource === 'number' ? todoSource : Number.parseInt(String(todoSource ?? 0), 10);
        const mappedTodoId = todoIdMap.get(originalTodoId);
        if (!mappedTodoId) {
          continue;
        }

        const titleSource = (rawSubtask as { title?: unknown }).title;
        let normalizedTitle: string;
        try {
          normalizedTitle = normalizeSubtaskTitle(typeof titleSource === 'string' ? titleSource : '');
        } catch {
          continue;
        }

        const positionSource = (rawSubtask as { position?: unknown }).position;
        const rawPosition = typeof positionSource === 'number' ? positionSource : Number.parseInt(String(positionSource ?? 0), 10);
        const position = Number.isInteger(rawPosition) && rawPosition > 0 ? rawPosition : 1;
        const isCompleted = Boolean((rawSubtask as { isCompleted?: unknown }).isCompleted);
        const createdAt = isoOrFallback((rawSubtask as { createdAt?: unknown }).createdAt, nowIso);
        const updatedAt = isoOrFallback((rawSubtask as { updatedAt?: unknown }).updatedAt, createdAt);

        const insertResult = insertImportedSubtaskStmt.run(
          mappedTodoId,
          normalizedTitle,
          position,
          isCompleted ? 1 : 0,
          createdAt,
          updatedAt
        );
        createdSubtaskIds.push(insertResult.lastInsertRowid as number);
      }

      for (const todoId of createdTodoIds) {
        normalizeSubtaskPositions(todoId);
      }

      for (const rawRelation of todoTagsInput) {
        if (!rawRelation || typeof rawRelation !== 'object') {
          continue;
        }
        const rawTodoId = (rawRelation as { todoId?: unknown }).todoId;
        const rawTagId = (rawRelation as { tagId?: unknown }).tagId;
        const originalTodoId = typeof rawTodoId === 'number' ? rawTodoId : Number.parseInt(String(rawTodoId ?? 0), 10);
        const originalTagId = typeof rawTagId === 'number' ? rawTagId : Number.parseInt(String(rawTagId ?? 0), 10);
        const mappedTodoId = todoIdMap.get(originalTodoId);
        const mappedTagId = tagIdMap.get(originalTagId);
        if (!mappedTodoId || !mappedTagId) {
          continue;
        }
        attachTagStmt.run(mappedTodoId, mappedTagId);
      }

      return {
        createdTodoIds,
        createdSubtaskIds,
        createdTagIds
      };
    });

    return transaction();
  }
};

function ensureTagRow(id: number, userId: number): TagRow {
  const row = selectTagByIdStmt.get(id, userId) as TagRow | undefined;
  if (!row) {
    throw new Error('Tag not found');
  }
  return row;
}

function ensureTemplateNameUnique(userId: number, name: string, excludeId?: number): void {
  const existing = selectTemplateByNameStmt.get(userId, name) as TemplateRow | undefined;
  if (existing && existing.id !== excludeId) {
    throw new Error('Template name already exists');
  }
}

function normalizeTemplateName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Template name is required');
  }
  if (trimmed.length > TEMPLATE_NAME_MAX_LENGTH) {
    throw new Error(`Template name must be at most ${TEMPLATE_NAME_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeTemplateCategory(input: string | null | undefined): string | null {
  if (input == null) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > TEMPLATE_CATEGORY_MAX_LENGTH) {
    throw new Error(`Category must be at most ${TEMPLATE_CATEGORY_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeTemplateDescription(input: string | null | undefined): string | null {
  if (input == null) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > TEMPLATE_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`Description must be at most ${TEMPLATE_DESCRIPTION_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeTemplateTodoTitle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Template todo title is required');
  }
  if (trimmed.length > TEMPLATE_TODO_TITLE_MAX_LENGTH) {
    throw new Error(`Todo title must be at most ${TEMPLATE_TODO_TITLE_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeTemplateTodoDescription(input: string | undefined): string {
  if (input == null) {
    return '';
  }
  const trimmed = input.trim();
  if (trimmed.length > TEMPLATE_TODO_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`Todo description must be at most ${TEMPLATE_TODO_DESCRIPTION_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeTemplateRecurrence(pattern: RecurrencePattern | null | undefined): RecurrencePattern | null {
  if (pattern == null) {
    return null;
  }
  if (pattern === 'daily' || pattern === 'weekly' || pattern === 'monthly' || pattern === 'yearly') {
    return pattern;
  }
  throw new Error('Invalid recurrence pattern');
}

function normalizeTemplateReminderMinutes(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!REMINDER_OPTIONS.has(numeric)) {
    throw new Error('Invalid reminder option');
  }
  return numeric;
}

function normalizeTemplateDueOffset(value: number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error('dueOffsetDays must be a non-negative integer');
  }
  return numeric;
}

function normalizeTemplateEstimatedDurationMinutes(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error('estimatedDurationMinutes must be a positive integer');
  }
  return numeric;
}

function normalizePriorityValue(value: Priority | string): Priority {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  throw new Error('Invalid priority');
}

function normalizeTemplateTagIds(userId: number, tagIds: number[] | undefined): number[] {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }
  const normalized = Array.from(
    new Set(
      tagIds
        .map((id) => (typeof id === 'number' ? id : Number.parseInt(String(id), 10)))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (normalized.length === 0) {
    return [];
  }

  tagDB.ensureOwned(userId, normalized);
  return normalized;
}

function normalizeTemplateSubtasksInput(subtasks: TemplateSubtaskDefinition[] | undefined): TemplateSubtaskDefinition[] {
  if (!subtasks || subtasks.length === 0) {
    return [];
  }

  const collected: TemplateSubtaskDefinition[] = [];
  for (const entry of subtasks) {
    if (!entry || typeof entry.title !== 'string') {
      continue;
    }

    const title = entry.title.trim();
    if (!title) {
      continue;
    }
    if (title.length > 200) {
      throw new Error('Subtask title must be at most 200 characters');
    }

    const positionValue = typeof entry.position === 'number' ? entry.position : Number.parseInt(String(entry.position ?? 0), 10);
    const position = Number.isInteger(positionValue) && positionValue > 0 ? positionValue : collected.length + 1;
    collected.push({ title, position });
  }

  if (collected.length === 0) {
    return [];
  }

  collected.sort((a, b) => a.position - b.position);
  return collected.map((entry, index) => ({ title: entry.title, position: index + 1 }));
}

function serializeTemplateTagIds(tagIds: number[]): string {
  if (tagIds.length === 0) {
    return '[]';
  }
  return JSON.stringify(tagIds);
}

function serializeTemplateSubtasks(subtasks: TemplateSubtaskDefinition[]): string {
  if (subtasks.length === 0) {
    return '[]';
  }
  const ordered = [...subtasks].sort((a, b) => a.position - b.position).map((entry, index) => ({
    title: entry.title,
    position: index + 1
  }));
  return JSON.stringify(ordered);
}

function normalizeHolidayDate(input: string): string {
  const parsed = DateTime.fromISO(input, { zone: 'Asia/Singapore' });
  if (!parsed.isValid) {
    throw new Error('Invalid holiday date');
  }

  const iso = parsed.startOf('day').toISODate();
  if (!iso) {
    throw new Error('Failed to normalize holiday date');
  }
  return iso;
}

function normalizeHolidayName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Holiday name is required');
  }
  return trimmed;
}

function toUtcIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) {
    return null;
  }

  const iso = parsed.toUTC().toISO();
  return iso ?? null;
}

function isoOrFallback(value: unknown, fallback: string): string {
  return toUtcIso(value) ?? fallback;
}

function coercePriority(value: unknown): Priority {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
}

function coerceReminderMinutes(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (Number.isInteger(numeric) && REMINDER_OPTIONS.has(numeric)) {
    return numeric;
  }
  return null;
}

function coerceRecurrencePattern(value: unknown): RecurrencePattern | null {
  if (value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly') {
    return value;
  }
  return null;
}

function sanitizeTagColor(value: unknown): string {
  if (typeof value !== 'string') {
    return FALLBACK_TAG_COLOR;
  }
  const trimmed = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(trimmed) ? trimmed : FALLBACK_TAG_COLOR;
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

function normalizeSubtaskTitle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Subtask title is required');
  }
  if (trimmed.length > 200) {
    throw new Error('Subtask title must be at most 200 characters');
  }
  return trimmed;
}

function ensureSubtaskRow(id: number, userId: number): SubtaskJoinRow {
  const row = selectSubtaskByIdWithUserStmt.get(id) as SubtaskJoinRow | undefined;
  if (!row || row.user_id !== userId) {
    throw new Error('Subtask not found');
  }
  return row;
}

function resolveInsertPosition(position: number | undefined, existing: SubtaskRow[]): number {
  const maxPosition = existing.length === 0 ? 0 : Math.max(...existing.map((row) => row.position));
  if (position == null || Number.isNaN(position)) {
    return maxPosition + 1;
  }

  const normalized = Math.floor(position);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return 1;
  }

  return Math.min(normalized, existing.length + 1);
}

function normalizeSubtaskPositions(todoId: number): void {
  const rows = selectSubtasksByTodoStmt.all(todoId) as SubtaskRow[];
  if (rows.length === 0) {
    return;
  }

  const now = singaporeUtcIso();
  const apply = db.transaction((ordered: SubtaskRow[]) => {
    let position = 1;
    for (const row of ordered) {
      if (row.position !== position) {
        updateSubtaskPositionStmt.run(position, now, row.id);
      }
      position += 1;
    }
  });

  apply(rows);
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

export const holidayDB = {
  listAll(): Holiday[] {
    const rows = selectAllHolidaysStmt.all() as HolidayRow[];
    return rows.map(mapHoliday);
  },

  listByDateRange(startDate: string, endDate: string): Holiday[] {
    if (!startDate || !endDate) {
      return [];
    }

    const rows = selectHolidaysInRangeStmt.all(startDate, endDate) as HolidayRow[];
    return rows.map(mapHoliday);
  },

  upsertMany(entries: { date: string; name: string }[]): void {
    if (entries.length === 0) {
      return;
    }

    const run = db.transaction((items: { date: string; name: string }[]) => {
      for (const item of items) {
        const date = normalizeHolidayDate(item.date);
        const name = normalizeHolidayName(item.name);
        const timestamp = singaporeUtcIso();
        upsertHolidayStmt.run(date, name, timestamp, timestamp);
      }
    });

    run(entries);
  }
};

export const subtaskDB = {
  listByTodo(todoId: number, userId: number): { subtasks: Subtask[]; progress: ProgressStats } {
    ensureTodoRow(todoId, userId);
    const rows = selectSubtasksByTodoStmt.all(todoId) as SubtaskRow[];
    const subtasks = rows.map(mapSubtask);
    return { subtasks, progress: calculateProgressStats(subtasks) };
  },

  create(
    todoId: number,
    userId: number,
    input: { title: string; position?: number }
  ): { subtask: Subtask; progress: ProgressStats } {
    ensureTodoRow(todoId, userId);

    const now = singaporeUtcIso();
    const title = normalizeSubtaskTitle(input.title);

    const transaction = db.transaction(() => {
      const existing = selectSubtasksByTodoStmt.all(todoId) as SubtaskRow[];
      const position = resolveInsertPosition(input.position, existing);
      for (const row of existing) {
        if (row.position >= position) {
          updateSubtaskPositionStmt.run(row.position + 1, now, row.id);
        }
      }

      const result = insertSubtaskStmt.run(todoId, title, position, now, now);
      return { id: result.lastInsertRowid as number, position };
    });

    const { id } = transaction();
    const createdRow = ensureSubtaskRow(id, userId);
    const subtask = mapSubtask(createdRow);
    const progress = calculateProgressForTodo(todoId, userId);
    return { subtask, progress };
  },

  updateTitle(id: number, userId: number, title: string): { subtask: Subtask; progress: ProgressStats } {
    const existing = ensureSubtaskRow(id, userId);
    const normalizedTitle = normalizeSubtaskTitle(title);
    const now = singaporeUtcIso();

    updateSubtaskTitleStmt.run(normalizedTitle, now, id);

    const updated = ensureSubtaskRow(id, userId);
    const subtask = mapSubtask(updated);
    const progress = calculateProgressForTodo(existing.todo_id, userId);
    return { subtask, progress };
  },

  toggleCompletion(
    id: number,
    userId: number,
    isCompleted: boolean
  ): { subtask: Subtask; progress: ProgressStats } {
    const existing = ensureSubtaskRow(id, userId);
    const now = singaporeUtcIso();

    toggleSubtaskCompletionStmt.run(isCompleted ? 1 : 0, now, id);

    const updated = ensureSubtaskRow(id, userId);
    const subtask = mapSubtask(updated);
    const progress = calculateProgressForTodo(existing.todo_id, userId);
    return { subtask, progress };
  },

  delete(id: number, userId: number): ProgressStats {
    const existing = ensureSubtaskRow(id, userId);
    deleteSubtaskStmt.run(id);
    normalizeSubtaskPositions(existing.todo_id);
    return calculateProgressForTodo(existing.todo_id, userId);
  },

  getProgress(todoId: number, userId: number): ProgressStats {
    ensureTodoRow(todoId, userId);
    return calculateProgressForTodo(todoId, userId);
  }
};

export const templateDB = {
  list(userId: number): Template[] {
    const rows = selectTemplatesByUserStmt.all(userId) as TemplateRow[];
    return rows.map(mapTemplate);
  },

  get(id: number, userId: number): Template | undefined {
    const row = selectTemplateByIdStmt.get(id, userId) as TemplateRow | undefined;
    return row ? mapTemplate(row) : undefined;
  },

  create(userId: number, input: TemplateInput): Template {
    const name = normalizeTemplateName(input.name);
    ensureTemplateNameUnique(userId, name);

    const now = singaporeUtcIso();
    const description = normalizeTemplateDescription(input.description ?? null);
    const category = normalizeTemplateCategory(input.category ?? null);
    const todoTitle = normalizeTemplateTodoTitle(input.todoTitle);
    const todoDescription = normalizeTemplateTodoDescription(input.todoDescription);
    const priority = normalizePriorityValue(input.priority);
    const recurrencePattern = normalizeTemplateRecurrence(input.recurrencePattern ?? null);
    const reminderMinutes = normalizeTemplateReminderMinutes(input.reminderMinutes ?? null);
    const dueOffsetDays = normalizeTemplateDueOffset(input.dueOffsetDays ?? 0);
    const estimatedDuration = normalizeTemplateEstimatedDurationMinutes(input.estimatedDurationMinutes ?? null);
    const tagIds = normalizeTemplateTagIds(userId, input.tagIds);
    const subtasks = normalizeTemplateSubtasksInput(input.subtasks);

    const result = insertTemplateStmt.run(
      userId,
      name,
      description,
      category,
      todoTitle,
      todoDescription,
      priority,
      recurrencePattern,
      reminderMinutes,
      dueOffsetDays,
      serializeTemplateTagIds(tagIds),
      serializeTemplateSubtasks(subtasks),
      estimatedDuration,
      now,
      now
    );

    const row = selectTemplateByIdStmt.get(result.lastInsertRowid as number, userId) as TemplateRow | undefined;
    if (!row) {
      throw new Error('Failed to create template');
    }
    return mapTemplate(row);
  },

  update(id: number, userId: number, input: Partial<TemplateInput>): Template {
    const existing = ensureTemplateRow(id, userId);
    const now = singaporeUtcIso();

    let name: string | undefined;
    if (input.name !== undefined) {
      name = normalizeTemplateName(input.name);
      ensureTemplateNameUnique(userId, name, id);
    }

    let description: string | null | undefined;
    if (input.description !== undefined) {
      description = normalizeTemplateDescription(input.description ?? null);
    }

    let category: string | null | undefined;
    if (input.category !== undefined) {
      category = normalizeTemplateCategory(input.category ?? null);
    }

    let todoTitle: string | undefined;
    if (input.todoTitle !== undefined) {
      todoTitle = normalizeTemplateTodoTitle(input.todoTitle);
    }

    let todoDescription: string | undefined;
    if (input.todoDescription !== undefined) {
      todoDescription = normalizeTemplateTodoDescription(input.todoDescription ?? '');
    }

    let priority: Priority | undefined;
    if (input.priority !== undefined) {
      priority = normalizePriorityValue(input.priority);
    }

    let recurrencePattern: RecurrencePattern | null | undefined;
    if (input.recurrencePattern !== undefined) {
      recurrencePattern = normalizeTemplateRecurrence(input.recurrencePattern ?? null);
    }

    let reminderMinutes: number | null | undefined;
    if (input.reminderMinutes !== undefined) {
      reminderMinutes = normalizeTemplateReminderMinutes(input.reminderMinutes ?? null);
    }

    let dueOffsetDays: number | undefined;
    if (input.dueOffsetDays !== undefined) {
      dueOffsetDays = normalizeTemplateDueOffset(input.dueOffsetDays ?? 0);
    }

    let estimatedDuration: number | null | undefined;
    if (input.estimatedDurationMinutes !== undefined) {
      estimatedDuration = normalizeTemplateEstimatedDurationMinutes(input.estimatedDurationMinutes ?? null);
    }

    let tagsJson: string | undefined;
    if (input.tagIds !== undefined) {
      const tagIds = normalizeTemplateTagIds(userId, input.tagIds);
      tagsJson = serializeTemplateTagIds(tagIds);
    }

    let subtasksJson: string | undefined;
    if (input.subtasks !== undefined) {
      const subtasks = normalizeTemplateSubtasksInput(input.subtasks);
      subtasksJson = serializeTemplateSubtasks(subtasks);
    }

    updateTemplateStmt.run({
      id,
      user_id: userId,
      name: name ?? null,
      description: description === undefined ? null : description ?? '__NULL__',
      category: category === undefined ? null : category ?? '__NULL__',
      todo_title: todoTitle ?? null,
      todo_description:
        todoDescription === undefined ? null : todoDescription === '' ? '__NULL__' : todoDescription,
      priority: priority ?? null,
      recurrence_pattern:
        recurrencePattern === undefined ? null : recurrencePattern ?? '__NULL__',
      reminder_minutes:
        reminderMinutes === undefined ? null : reminderMinutes ?? '__NULL__',
      due_offset_days: dueOffsetDays ?? null,
      tags: tagsJson ?? null,
      subtasks: subtasksJson ?? null,
      estimated_duration_minutes:
        estimatedDuration === undefined ? null : estimatedDuration ?? '__NULL__',
      updated_at: now
    });

    const row = selectTemplateByIdStmt.get(id, userId) as TemplateRow | undefined;
    if (!row) {
      throw new Error('Template not found after update');
    }
    return mapTemplate(row);
  },

  delete(id: number, userId: number): void {
    ensureTemplateRow(id, userId);
    deleteTemplateStmt.run(id, userId);
  },

  use(
    id: number,
    userId: number,
    options: { dueDate?: string | null; dueOffsetDays?: number | null } = {}
  ): { todo: Todo; subtasks: Subtask[]; tags: Tag[]; missingTagIds: number[] } {
    const templateRow = ensureTemplateRow(id, userId);
    const template = mapTemplate(templateRow);

    const dueDateProvided = options.dueDate !== undefined;
    const offsetProvided = options.dueOffsetDays !== undefined;

    let dueDate: string | null = null;
    if (dueDateProvided) {
      const rawDue = options.dueDate;
      if (rawDue == null) {
        dueDate = null;
      } else {
        try {
          dueDate = parseSingaporeDate(rawDue);
        } catch (error) {
          throw new Error((error as Error).message);
        }

        if (!dueDate || !isFutureSingaporeDate(dueDate)) {
          throw new Error('Due date must be at least one minute in the future (Singapore timezone)');
        }
      }
    } else {
      const offset = normalizeTemplateDueOffset(offsetProvided ? options.dueOffsetDays ?? 0 : template.dueOffsetDays);
      if (offset >= 0) {
        let candidate = getSingaporeNow().plus({ days: offset });
        let iso = candidate.toUTC().toISO();
        if (!iso) {
          throw new Error('Failed to compute due date from offset');
        }
        if (!isFutureSingaporeDate(iso)) {
          candidate = candidate.plus({ minutes: 5 });
          iso = candidate.toUTC().toISO();
          if (!iso) {
            throw new Error('Failed to compute due date from offset');
          }
        }
        dueDate = iso;
      }
    }

    if (template.recurrencePattern && !dueDate) {
      throw new Error('Recurring templates require a due date when used');
    }

    if (template.reminderMinutes != null && !dueDate) {
      throw new Error('Templates with reminders require a due date when used');
    }

    const missingTagIds: number[] = [];
    const validTagIds: number[] = [];
    for (const tagId of template.tagIds) {
      const row = selectTagByIdStmt.get(tagId, userId) as TagRow | undefined;
      if (!row) {
        missingTagIds.push(tagId);
        continue;
      }
      validTagIds.push(row.id);
    }

    const transaction = db.transaction(() => {
      const created = todoDB.create({
        userId,
        title: template.todoTitle,
        description: template.todoDescription,
        priority: template.priority,
        dueDate,
        isRecurring: Boolean(template.recurrencePattern),
        recurrencePattern: template.recurrencePattern,
        reminderMinutes: template.reminderMinutes
      });

      if (validTagIds.length > 0) {
        tagDB.attachMany(created.id, validTagIds, userId);
      }

      if (template.subtasks.length > 0) {
        const nowIso = singaporeUtcIso();
        let position = 1;
        for (const subtask of template.subtasks) {
          insertSubtaskStmt.run(created.id, subtask.title, position, nowIso, nowIso);
          position += 1;
        }
      }

      const finalTodo = todoDB.getById(created.id, userId);
      if (!finalTodo) {
        throw new Error('Failed to load todo created from template');
      }

      return {
        todo: finalTodo,
        subtasks: finalTodo.subtasks,
        tags: finalTodo.tags,
        missingTagIds
      };
    });

    return transaction();
  }
};

export { db };
