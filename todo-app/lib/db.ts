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
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
    due_date TEXT,
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
  CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
  CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(is_completed);

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

  CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, name COLLATE NOCASE),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

  CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (todo_id, tag_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_todo_tags_todo_id ON todo_tags(todo_id);
  CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id ON todo_tags(tag_id);
`);

const todoColumns = db.prepare(`PRAGMA table_info('todos')`).all() as { name: string }[];
const hasPriorityColumn = todoColumns.some((column) => column.name === 'priority');

if (!hasPriorityColumn) {
  try {
    db.exec(`ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low'))`);
  } catch (error) {
    if (!(error instanceof Error) || (!error.message.includes('duplicate column name') && !error.message.includes('no such table'))) {
      throw error;
    }
  }
}

db.exec(`UPDATE todos SET priority = 'medium' WHERE priority IS NULL OR priority NOT IN ('high', 'medium', 'low')`);

const ensureDefaultUser = db.prepare(`
  INSERT INTO users (id, email)
  SELECT 1, 'demo@example.com'
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1)
`);

ensureDefaultUser.run();

export type Priority = 'high' | 'medium' | 'low';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Subtask {
  id: number;
  todoId: number;
  title: string;
  position: number;
  isCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: number;
  userId: number;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

type SubtaskRow = {
  id: number;
  todo_id: number;
  title: string;
  position: number;
  is_completed: 0 | 1;
  created_at: string;
  updated_at: string;
};

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

type TagRow = {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
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

const selectTodos = db.prepare<TodoRow[]>(`SELECT * FROM todos WHERE user_id = ? ORDER BY is_completed ASC, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC, due_date IS NULL ASC, due_date ASC, created_at ASC`);

const selectTodoById = db.prepare<TodoRow | undefined>(`SELECT * FROM todos WHERE id = ? AND user_id = ?`);

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
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertTodoWithMetadataStmt = db.prepare(`
  INSERT INTO todos (
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
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectSubtasksByTodo = db.prepare<SubtaskRow[]>(`SELECT * FROM subtasks WHERE todo_id = ? ORDER BY position ASC, id ASC`);
const selectSubtaskById = db.prepare<SubtaskRow | undefined>(`SELECT * FROM subtasks WHERE id = ?`);

const selectTagsByUser = db.prepare<TagRow[]>(`SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC`);

const selectTagsByTodo = db.prepare<TagRow[]>(`
  SELECT t.*
  FROM tags t
  INNER JOIN todo_tags tt ON tt.tag_id = t.id
  WHERE tt.todo_id = ?
  ORDER BY t.name COLLATE NOCASE ASC
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
    updated_at = @updated_at
  WHERE id = @id AND user_id = @user_id
`);

const deleteTodoStmt = db.prepare(`DELETE FROM todos WHERE id = ? AND user_id = ?`);

const insertTagStmt = db.prepare(`
  INSERT INTO tags (user_id, name, color, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

const insertTagWithMetadataStmt = db.prepare(`
  INSERT INTO tags (user_id, name, color, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

const updateTagStmt = db.prepare(`
  UPDATE tags
  SET name = @name,
      color = @color,
      updated_at = @updated_at
  WHERE id = @id AND user_id = @user_id
`);

const deleteTagStmt = db.prepare(`DELETE FROM tags WHERE id = ? AND user_id = ?`);

const selectTagByName = db.prepare<TagRow | undefined>(
  `SELECT * FROM tags WHERE user_id = ? AND name = ? COLLATE NOCASE`
);

const selectTagById = db.prepare<TagRow | undefined>(`SELECT * FROM tags WHERE id = ? AND user_id = ?`);

const insertSubtaskStmt = db.prepare(`
  INSERT INTO subtasks (todo_id, title, position, is_completed, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertSubtaskWithMetadataStmt = db.prepare(`
  INSERT INTO subtasks (todo_id, title, position, is_completed, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const updateSubtaskStmt = db.prepare(`
  UPDATE subtasks
  SET title = @title,
      position = @position,
      is_completed = @is_completed,
      updated_at = @updated_at
  WHERE id = @id AND todo_id = @todo_id
`);

const deleteSubtaskStmt = db.prepare(`DELETE FROM subtasks WHERE id = ? AND todo_id = ?`);

const insertTodoTagStmt = db.prepare(`
  INSERT OR IGNORE INTO todo_tags (todo_id, tag_id)
  VALUES (?, ?)
`);

const deleteTodoTagStmt = db.prepare(`DELETE FROM todo_tags WHERE todo_id = ? AND tag_id = ?`);

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
      now,
      now
    );

    const row = selectTodoById.get(result.lastInsertRowid as number, args.userId);
    if (!row) {
      throw new Error('Failed to create todo');
    }

    return mapTodo(row);
  },

  createWithMetadata(args: {
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
    createdAt: string;
    updatedAt: string;
  }): Todo {
    const result = insertTodoWithMetadataStmt.run(
      args.userId,
      args.title,
      args.description,
      args.priority,
      args.dueDate,
      args.isCompleted ? 1 : 0,
      args.completedAt,
      args.isRecurring ? 1 : 0,
      args.recurrencePattern,
      args.reminderMinutes,
      args.createdAt,
      args.updatedAt
    );

    const row = selectTodoById.get(result.lastInsertRowid as number, args.userId) as TodoRow | undefined;
    if (!row) {
      throw new Error('Failed to insert todo with metadata');
    }
    return mapTodo(row);
  },

  listByUser(userId: number): Todo[] {
    const rows = selectTodos.all(userId) as TodoRow[];
    return rows.map(mapTodo);
  },

  listWithRelations(userId: number): Array<Todo & { subtasks: Subtask[]; tagIds: number[] }> {
    return this.listByUser(userId).map((todo) => {
      const subtasks = this.listSubtasks(todo.id);
      const tags = this.listTagsForTodo(todo.id);
      return { ...todo, subtasks, tagIds: tags.map((tag) => tag.id) };
    });
  },

  listSubtasks(todoId: number): Subtask[] {
    const rows = selectSubtasksByTodo.all(todoId) as SubtaskRow[];
    return rows.map(mapSubtask);
  },

  listTags(userId: number): Tag[] {
    const rows = selectTagsByUser.all(userId) as TagRow[];
    return rows.map(mapTag);
  },

  listTagsForTodo(todoId: number): Tag[] {
    const rows = selectTagsByTodo.all(todoId) as TagRow[];
    return rows.map(mapTag);
  },

  getById(id: number, userId: number): Todo | undefined {
    const row = selectTodoById.get(id, userId) as TodoRow | undefined;
    return row ? mapTodo(row) : undefined;
  },

  getWithRelations(id: number, userId: number): (Todo & { subtasks: Subtask[]; tagIds: number[] }) | undefined {
    const todo = this.getById(id, userId);
    if (!todo) {
      return undefined;
    }
    const subtasks = this.listSubtasks(todo.id);
    const tags = this.listTagsForTodo(todo.id);
    return { ...todo, subtasks, tagIds: tags.map((tag) => tag.id) };
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

  toggleComplete(id: number, userId: number, isCompleted: boolean): Todo {
    const now = singaporeUtcIso();

    updateTodoStmt.run({
      id,
      user_id: userId,
      is_completed: isCompleted ? 1 : 0,
      completed_at: isCompleted ? now : '__NULL__',
      updated_at: now
    });

    const row = selectTodoById.get(id, userId);
    if (!row) {
      throw new Error('Todo not found after toggle');
    }

    return mapTodo(row);
  }
};

export const tagDB = {
  listByUser(userId: number): Tag[] {
    const rows = selectTagsByUser.all(userId) as TagRow[];
    return rows.map(mapTag);
  },

  getByName(userId: number, name: string): Tag | undefined {
    const row = selectTagByName.get(userId, name) as TagRow | undefined;
    return row ? mapTag(row) : undefined;
  },

  getById(id: number, userId: number): Tag | undefined {
    const row = selectTagById.get(id, userId) as TagRow | undefined;
    return row ? mapTag(row) : undefined;
  },

  create(args: { userId: number; name: string; color: string }): Tag {
    const now = singaporeUtcIso();
    const result = insertTagStmt.run(args.userId, args.name, args.color, now, now);
    const row = selectTagById.get(result.lastInsertRowid as number, args.userId) as TagRow | undefined;
    if (!row) {
      throw new Error('Failed to create tag');
    }
    return mapTag(row);
  },

  createWithMetadata(args: { userId: number; name: string; color: string; createdAt: string; updatedAt: string }): Tag {
    const result = insertTagWithMetadataStmt.run(args.userId, args.name, args.color, args.createdAt, args.updatedAt);
    const row = selectTagById.get(result.lastInsertRowid as number, args.userId) as TagRow | undefined;
    if (!row) {
      throw new Error('Failed to create tag with metadata');
    }
    return mapTag(row);
  },

  update(args: { id: number; userId: number; name: string; color: string }): Tag {
    const now = singaporeUtcIso();
    updateTagStmt.run({ id: args.id, user_id: args.userId, name: args.name, color: args.color, updated_at: now });
    const row = selectTagById.get(args.id, args.userId) as TagRow | undefined;
    if (!row) {
      throw new Error('Failed to update tag');
    }
    return mapTag(row);
  },

  delete(id: number, userId: number): void {
    deleteTagStmt.run(id, userId);
  }
};

export const subtaskDB = {
  listByTodo(todoId: number): Subtask[] {
    const rows = selectSubtasksByTodo.all(todoId) as SubtaskRow[];
    return rows.map(mapSubtask);
  },

  create(args: { todoId: number; title: string; position: number; isCompleted?: boolean }): Subtask {
    const now = singaporeUtcIso();
    const result = insertSubtaskStmt.run(
      args.todoId,
      args.title,
      args.position,
      args.isCompleted ? 1 : 0,
      now,
      now
    );
    const row = selectSubtaskById.get(result.lastInsertRowid as number) as SubtaskRow | undefined;
    if (!row) {
      throw new Error('Failed to create subtask');
    }
    return mapSubtask(row);
  },

  createWithMetadata(args: {
    todoId: number;
    title: string;
    position: number;
    isCompleted: boolean;
    createdAt: string;
    updatedAt: string;
  }): Subtask {
    const result = insertSubtaskWithMetadataStmt.run(
      args.todoId,
      args.title,
      args.position,
      args.isCompleted ? 1 : 0,
      args.createdAt,
      args.updatedAt
    );
    const row = selectSubtaskById.get(result.lastInsertRowid as number) as SubtaskRow | undefined;
    if (!row) {
      throw new Error('Failed to create subtask with metadata');
    }
    return mapSubtask(row);
  },

  update(args: { id: number; todoId: number; title: string; position: number; isCompleted: boolean }): Subtask {
    const now = singaporeUtcIso();
    updateSubtaskStmt.run({
      id: args.id,
      todo_id: args.todoId,
      title: args.title,
      position: args.position,
      is_completed: args.isCompleted ? 1 : 0,
      updated_at: now
    });
    const row = selectSubtaskById.get(args.id) as SubtaskRow | undefined;
    if (!row) {
      throw new Error('Failed to update subtask');
    }
    return mapSubtask(row);
  },

  delete(id: number, todoId: number): void {
    deleteSubtaskStmt.run(id, todoId);
  }
};

export const todoTagDB = {
  attach(todoId: number, tagId: number): void {
    insertTodoTagStmt.run(todoId, tagId);
  },

  detach(todoId: number, tagId: number): void {
    deleteTodoTagStmt.run(todoId, tagId);
  }
};

export { db };
