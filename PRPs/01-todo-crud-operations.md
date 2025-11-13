# PRP 01 · Todo CRUD Operations

## Feature Overview
Foundational CRUD functionality lets authenticated users create, view, update, and delete todos while enforcing project-wide rules around Singapore timezone dates, validation, optimistic UI, and secure data access. Todos are the core parent entity for advanced features (priority, recurrence, subtasks, tags, templates, notifications); correctness and consistency here underpin the rest of the system.

## User Stories
- **Busy Professional**: “As a productivity-minded user, I need to add todos quickly so I can capture tasks before I forget them.”
- **Planner**: “As someone who schedules my work, I want to set due dates and reminders so upcoming tasks stay visible.”
- **Returning User**: “As a returning user, I want my todo list to load instantly and reflect the latest status without manual refreshes.”

## User Flow
1. User signs in (or is already authenticated) and lands on `/`.
2. User enters a title in the “Create Todo” form; optional metadata includes description, due date, priority, recurrence, reminder.
3. On submit, client sends `POST /api/todos`; UI optimistically appends item pending server confirmation.
4. Todos render in grouped sections (Overdue, Active, Completed) sorted by priority then due date.
5. User can:
   - Toggle completion using checkbox (invokes `PUT /api/todos/[id]`).
   - Edit metadata via modal/drawer (same endpoint).
   - Delete todo with confirmation (calls `DELETE /api/todos/[id]`).
6. Subtasks, tags, recurrence, reminders react to base todo updates; completed todos slide into Completed section automatically.

## Technical Requirements
### Database Schema (`lib/db.ts`)
- Table `todos` columns:
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `user_id` INTEGER NOT NULL REFERENCES `users(id)` ON DELETE CASCADE
  - `title` TEXT NOT NULL (trimmed, 1–200 chars)
  - `description` TEXT DEFAULT '' (trimmed, 0–2000 chars)
  - `priority` TEXT NOT NULL DEFAULT 'medium' CHECK IN ('high','medium','low')
  - `due_date` TEXT NULL (ISO string in Singapore timezone)
  - `is_completed` INTEGER NOT NULL DEFAULT 0
  - `completed_at` TEXT NULL
  - `is_recurring` INTEGER NOT NULL DEFAULT 0
  - `recurrence_pattern` TEXT NULL CHECK pattern validity
  - `reminder_minutes` INTEGER NULL (allowed values: 15,30,60,120,1440,2880,10080)
  - `created_at` TEXT NOT NULL
  - `updated_at` TEXT NOT NULL
- Ensure `PRAGMA foreign_keys = ON`.
- Add indexes: `CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);`, `idx_todos_due_date`, `idx_todos_completed`.
- Migration style: wrap `ALTER TABLE` in try/catch to avoid errors on re-run.

### Type Definitions
- Export in `lib/db.ts`:
  ```ts
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
    createdAt: string;
    updatedAt: string;
  }
  ```
- Provide query helpers typed accordingly.

### Database Operations (sync `better-sqlite3`)
- `todoDB.create({ userId, title, description, priority, dueDate, isRecurring, recurrencePattern, reminderMinutes }): Todo`
- `todoDB.listByUser(userId: number): Todo[]` sorted by `is_completed`, `priority`, `due_date`.
- `todoDB.getById(id: number, userId: number): Todo | undefined`
- `todoDB.update(id, userId, partial: Partial<...>): Todo`
- `todoDB.delete(id: number, userId: number): void`
- `todoDB.toggleComplete(id: number, userId: number, isCompleted: boolean, completedAt: string | null): Todo`
- Use prepared statements cached at module scope.

### API Routes (Next.js 16 App Router)
- `POST /api/todos`
  - Body: `{ title, description?, priority?, dueDate?, isRecurring?, recurrencePattern?, reminderMinutes? }`.
  - Validate session via `await getSession()`; respond 401 if absent.
  - Enforce user ownership; `session.userId` stored on todo.
  - Use `getSingaporeNow()` for timestamps; convert dueDate input via `parseSingaporeDate()` util if present.
  - Return JSON `{ todo }`.
- `GET /api/todos`
  - Returns `{ todos }` for authenticated user.
- `GET /api/todos/[id]`
  - Validate `const { id } = await params`.
  - Return 404 if missing or not owned.
- `PUT /api/todos/[id]`
  - Accept partial updates; re-run validation on provided fields.
  - Handle completion toggles and recurrence creation logic (if `isRecurring` and `isCompleted` flips true, delegate to recurrence helper to spawn next instance).
- `DELETE /api/todos/[id]`
  - Cascade deletes subtasks, tags associations via foreign keys.
- Responses include `NextResponse.json()` with status codes and error messages consistent across routes.

### Validation Rules
- Titles trimmed; reject empty or >200 chars with 400 error.
- Description optional, trimmed, ≤2000 chars.
- Due date optional; if provided, parse using Singapore timezone and ensure `dueDate > getSingaporeNow().plus({ minutes: 1 })`.
- `priority` must be one of allowed values; default `medium`.
- If `isRecurring` true, ensure `recurrencePattern` set and due date provided.
- `reminderMinutes` allowed only from enumerated set and only when due date exists.
- All numeric IDs parsed as integers; reject NaN.

### Timezone Handling
- Never use `new Date()` directly for calculations; rely on `getSingaporeNow()` and helper functions in `lib/timezone.ts`.
- Store ISO strings (UTC) but derive using Singapore zone to avoid daylight savings issues (not present but for consistency).
- Sorting/grouping on server should treat due dates as Singapore local before comparisons.

## UI Components & UX (app/page.tsx)
- **Create Todo Form**
  - Text input for title (auto-focus).
  - Optional fields (toggleable panel) for description, priority dropdown, due date picker (Singapore timezone aware), recurrence controls, reminder dropdown.
  - Disable submit when pending or invalid; show inline validation messages.
- **Todo List Sections**
  - Group by Overdue (dueDate < now and not completed), Active (incomplete), Completed (completed true) with counts.
  - Each item displays priority badge, title, description preview, due date (formatted via `formatSingaporeDate`), recurrence icon, reminder icon, subtasks progress.
- **Actions**
  - Checkbox to toggle completion; optimistic update with rollback on failure.
  - “Edit” opens modal with full form; patch changes via `PUT`.
  - “Delete” opens confirmation; on success remove from state.
  - Show skeleton loader while fetching initial data.
- **Optimistic UI**
  - Add placeholder todo when creating; if server fails, remove and show toast.
  - Use `mutate`/`setTodos` pattern to avoid flicker.
- **Accessibility**
  - Form controls labelled; keyboard focus maintained.
  - Sections have headings for screen readers; Completed collapsible to reduce clutter.

## Edge Cases & Constraints
- Guard against duplicate submissions when user double-clicks create button (disable, dedupe by trimmed title optional).
- When due date removed from recurring todo, also disable recurrence/reminder server-side.
- Completed todos should store `completedAt` timestamp via Singapore now.
- Sorting rules: Overdue sorted soonest first; Active sorted by priority (high→low) then due date; Completed sorted by `completed_at` desc.
- If todo has recurring flag and user marks incomplete again, cancel in-progress next-instance creation (no duplicate).
- API must return 404 when user tries to access todo belonging to another user.
- Validate JSON body size to avoid huge payloads (reject >10KB with 413 optional).

## Acceptance Criteria
- Users can create todos with just a title; defaults apply correctly.
- Todos load with correct grouping and ordering for the signed-in user.
- Editing updates metadata and reflects immediately without page reload.
- Completion toggles persist and move todo to correct section.
- Deleting a todo removes it and its child entities (subtasks, tags associations).
- All API routes enforce authentication and ownership checks.
- Due date and reminder validation respects Singapore timezone requirements.
- Client shows helpful error states and resets optimistic mutations on failure.

## Testing Requirements
- **Unit Tests**
  - Database CRUD operations (create/read/update/delete) ensure fields stored, updated timestamps, cascade on delete.
  - Validation utilities for titles, due dates, reminders.
  - Sorting helper producing expected grouping given sample dataset.
- **Playwright E2E**
  - Create todo with minimal data; ensure appears in Active section.
  - Create todo with full metadata (priority, due date, recurrence, reminder) and verify UI badges.
  - Edit existing todo; assert updated fields shown.
  - Toggle completion moves todo to Completed section and persists after reload.
  - Delete todo removes from UI and ensures subtasks/tags cleaned up (assert via UI absence).
  - Due date validation prevents past date (assert error message).
- **API Integration Tests (optional)**
  - Hitting endpoints with invalid payloads returns appropriate 4xx errors.
  - Unauthorized requests return 401.

## Out of Scope
- Bulk create/edit/delete operations.
- Cross-user sharing or delegation of todos.
- Offline persistence beyond optimistic updates (no local storage sync).
- Kanban or calendar views (covered in other features).

## Success Metrics
- All Todo CRUD Playwright tests pass in CI (3 consecutive runs).
- Average API response time for CRUD endpoints < 250 ms on local dev dataset.
- No known data consistency bugs post-release (zero open issues labelled `todo-crud`).
- User feedback indicates ability to create/edit/delete todos without blockers.

## Developer Notes
- Follow `.github/copilot-instructions.md` for architecture patterns, especially synchronous DB usage and Singapore timezone utilities.
- Keep `app/page.tsx` monolithic state manageable with existing hooks; avoid introducing new global state libraries.
- Coordinate with Feature 02+ PRPs to ensure priority, recurrence, tags integration remains consistent (e.g., avoid resetting fields unexpectedly).
- Document any new helper utilities in `USER_GUIDE.md` if user-visible behavior changes.
