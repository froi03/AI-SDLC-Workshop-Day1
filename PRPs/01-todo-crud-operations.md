# Feature 01 – Todo CRUD Operations

## Feature Overview
- Establish the foundational ability for authenticated users to create, read, update, and delete todos.
- Persist todos in SQLite (via `better-sqlite3`) while enforcing Singapore timezone business rules.
- Provide a responsive client experience with optimistic updates, clear status grouping (Overdue, Active, Completed), and validation feedback.
- Act as the baseline data model that later features (priority, recurrence, reminders, subtasks, tags, templates, search, export, calendar) extend.

## User Stories
1. **Busy Professional** – As an authenticated user, I want to quickly add a todo with just a title so I can capture tasks without friction.
2. **Detail-Oriented Planner** – As a user planning my week, I want to set due dates (in Singapore time) and optional metadata so tasks stay organized and future-ready.
3. **Status Monitor** – As a user triaging my work, I want todos to be grouped by status (overdue, active, completed) so I instantly know what needs attention.

## User Flow
### Create Todo
1. User clicks "Add Todo" (floating button on mobile, inline form on desktop).
2. Modal or drawer opens with fields: title (required), description, due date/time (optional), priority (defaults to medium), recurrence toggle, reminder dropdown, tag picker (disabled until other features ship).
3. User submits form. Client validates title and due date before sending to API.
4. UI performs optimistic insert into Active list; API persists and returns canonical todo.
5. UI reconciles response (ID, timestamps) or rolls back optimistic entry on error.

### Read Todos
1. On page load, client requests `GET /api/todos` after session validation.
2. Response returns todos with related aggregates (subtask counts, tag IDs) for rendering.
3. Client sorts todos by status sections: Overdue (due date < now, not completed), Active (due >= now or no due date, not completed), Completed (completed_at set).
4. Within Overdue/Active, sort by priority and due date ascending; Completed sorted by most recently completed.

### Update Todo
1. User selects "Edit" on an existing todo (inline icon or context menu).
2. Edit modal pre-populates fields; mutations happen locally via controlled inputs.
3. Submitting calls `PUT /api/todos/[id]` with changed attributes.
4. UI applies optimistic patch; on failure, revert and display error toast.

### Toggle Completion
1. User clicks completion checkbox.
2. Client immediately toggles UI state and sends `PUT /api/todos/[id]` with `completed_at` set to Singapore current time (or cleared) plus metadata for recurring feature handshake.
3. Response returns updated todo plus next occurrence when applicable.

### Delete Todo
1. User clicks delete icon → confirmation dialog summarizing cascaded data removal (subtasks, tag links, reminders).
2. Confirm triggers `DELETE /api/todos/[id]`.
3. UI removes todo optimistically; failure reinstates with error notification.

## Technical Requirements
### Database Schema (`todos` table)
Use `lib/db.ts` as the single source of truth. Fields (all `NOT NULL` unless noted):
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id` INTEGER (FK → `users.id`, cascade on delete)
- `title` TEXT (trimmed, 1–200 chars)
- `description` TEXT DEFAULT ''
- `due_date` TEXT nullable (ISO string in Singapore TZ)
- `is_completed` INTEGER DEFAULT 0
- `completed_at` TEXT nullable (ISO string Singapore TZ)
- `priority` TEXT DEFAULT 'medium' (enum introduced in Feature 02 but column created here)
- `recurrence_pattern` TEXT nullable (enum from Feature 03; allow null initially)
- `reminder_minutes` INTEGER nullable (added early for forward compatibility)
- `created_at` TEXT DEFAULT current Singapore timestamp
- `updated_at` TEXT DEFAULT current Singapore timestamp
- Indexes: `(user_id)`, `(user_id, due_date)`, `(user_id, is_completed)`

### Data Access Layer (`lib/db.ts`)
- Initialize `better-sqlite3` with database file `todos.db` in project root (or Railway volume when deployed).
- Provide synchronous CRUD helpers (`todoDB`) exposing:
  - `listByUser(userId: number): Todo[]`
  - `findById(id: number, userId: number): Todo | undefined`
  - `create(userId: number, input: CreateTodoInput): Todo`
  - `update(id: number, userId: number, patch: UpdateTodoInput): Todo`
  - `delete(id: number, userId: number): void`
- Ensure all SQL uses prepared statements with named parameters.
- Maintain referential integrity with `ON DELETE CASCADE` for subtasks (`Feature 05`) and tag pivots (`Feature 06`).

### Shared Types (`lib/db.ts` & `lib/types.ts` if split)
```ts
export type Priority = 'high' | 'medium' | 'low';
export interface Todo {
  id: number;
  userId: number;
  title: string;
  description: string;
  dueDate: string | null; // ISO string (Asia/Singapore)
  isCompleted: boolean;
  completedAt: string | null;
  priority: Priority;
  recurrencePattern: RecurrencePattern | null; // forward compat
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
```
(Define `RecurrencePattern` in Feature 03; here it may be `type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly'` but unused.)

### API Contracts (Next.js App Router)
All routes live under `app/api/todos/` and start by calling `getSession()` from `lib/auth.ts`.

`POST /api/todos`
- Request body: `{ title: string; description?: string; dueDate?: string | null; priority?: Priority; recurrencePattern?: RecurrencePattern | null; reminderMinutes?: number | null; }
- Validation:
  - `title`: trimmed, 1–200 chars
  - `dueDate`: optional, when provided must parse via `parseSingaporeInput()` and be ≥ `getSingaporeNow().add(1 minute)`
  - `reminderMinutes` requires `dueDate`
- Response 201: `{ todo: Todo }`
- Errors: 400 (validation), 401 (unauthenticated), 500 (unexpected)

`GET /api/todos`
- Query returns all todos for session user including aggregated metadata:
  - `subtaskStats`: `{ total: number; completed: number }`
  - `tagIds`: `number[]`
- Response 200: `{ todos: TodoWithRelations[] }`

`GET /api/todos/[id]`
- Params via `const { id } = await params;`
- Response 200: `{ todo: TodoWithRelations }`
- Errors: 404 when not found or owner mismatch

`PUT /api/todos/[id]`
- Accept same body as create (partial) plus `isCompleted`.
- Server sets `updated_at = now` and, when `isCompleted` transitions true→false, sets/clears `completed_at` using Singapore clock.
- Response 200: `{ todo: TodoWithRelations }`

`DELETE /api/todos/[id]`
- Response 204 on success
- Cascade removes subtasks and todo-tag pivots automatically in DB

### Validation Rules
- Trim string inputs; reject empty title.
- Enforce max lengths: title ≤ 200, description ≤ 2000.
- Disallow due dates in the past (< current Singapore time + 1 minute).
- When removing `dueDate`, also null out `reminderMinutes` and `recurrencePattern`.
- Ensure authenticated user owns todo before mutations.

### Timezone Handling
- Replace all `new Date()` usages with `getSingaporeNow()` and helpers from `lib/timezone.ts`.
- Store timestamps as ISO strings already converted to Singapore timezone (prefer `formatISO(setZonedTime(...))`).
- For comparisons, convert stored `due_date` into Luxon/Temporal objects via timezone helper utilities.

## UI Components
- `app/page.tsx` (client component) houses form state, fetch logic, and rendering.
- Controlled form components using React hooks; integrate Tailwind CSS 4 for layout.
- Sections:
  - Overdue: red header, includes todos with due date < now and not completed.
  - Active: default list for due ≥ now or no due date.
  - Completed: collapsible section showing completed items with timestamp.
- Components/patterns:
  - `TodoFormModal`: create/edit modal with accessible labels and keyboard support.
  - `TodoList`: renders sections with virtualization-ready structure for future scaling.
  - `TodoItem`: handles checkbox, metadata chips, action buttons.
  - `ConfirmationDialog`: reusable for delete confirmation.
- Use optimistic UI patterns: update local state immediately, track pending state via `isSaving` flags, show inline spinners.
- Display validation errors inline (below title, due date fields) and toast-level errors for server failures.

## Edge Cases
- User submits title with excessive whitespace → trim and validate.
- Due date equals current minute → reject; must be at least +1 minute.
- Client offline during optimistic update → detect fetch error, rollback state, surface “Failed to sync” banner.
- Deleting a todo currently shown in edit modal → modal closes gracefully.
- Large todo lists: ensure sorting stable and performant; consider memoized selectors.
- Session expiration between optimistic update and server response → rollback and redirect to login.
- Cross-feature readiness: allow storing metadata fields even before dependent features are fully implemented (no-op on UI until features 02–06 ship).

## Acceptance Criteria
- Users can create a todo with only a title; todo appears in Active section immediately.
- Validation prevents empty titles and due dates in the past (Singapore time).
- Todos sort by status (Overdue → Active → Completed) and within sections by priority & due date.
- Toggling completion moves todo to Completed section (with timestamp) or back to Active/Overdue.
- Deleting a todo removes associated subtasks and tag links (cascade) without orphan records.
- API responses respect authenticated user boundaries; accessing others' todos returns 404.
- UI performs optimistic updates and recovers gracefully on errors.

## Testing Requirements
### Playwright E2E (tests/01-todo-crud.spec.ts)
- Create todo with title only (assert visible in Active section).
- Create todo with title + description + due date + metadata (where features available) and verify due date formatting.
- Edit todo title and due date; ensure sections update (Active ↔ Overdue).
- Toggle todo completion on/off; assert Completed section counts update.
- Delete todo; confirm removal and absence on page reload.
- Attempt to create todo with past due date; assert validation error message.
- Check optimistic UI: simulate slow network (Playwright route fulfill delay) and ensure spinner + final state matches server.

### Unit Tests (Vitest / Jest)
- `lib/timezone.ts`: ensure `isFutureSingaporeDatetime` helper validates due dates.
- `lib/db.ts`: CRUD operations respect per-user isolation and cascade deletes.
- `app/api/todos` route handlers: validate input, unauthorized access, error handling.
- Utility sort function: ensures deterministic ordering across priority and due date.

### Manual QA
- Mobile viewport form usability (focus order, keyboard dismissal).
- Accessibility: focus trap within modal, keyboard navigation, ARIA labels on actions.
- Error states: simulate backend failure, confirm rollback and toast.

## Out of Scope
- Bulk todo creation/import (covered in Feature 09).
- Calendar visualization (Feature 10).
- Detailed analytics or reporting.
- Offline-first caching beyond optimistic updates.
- Sharing todos between users.

## Success Metrics
- Todo creation to visible rendering < 300 ms (after API response) under normal latency.
- 0 validation regressions reported in Playwright suite (all assertions pass for 3 consecutive runs).
- Support at least 500 todos per user with sorting/filtering under 100 ms on client.
- Post-release bug rate < 2 issues/week related to CRUD functionality.
- User satisfaction: qualitative feedback indicates todo input feels “instant” and reliable.
