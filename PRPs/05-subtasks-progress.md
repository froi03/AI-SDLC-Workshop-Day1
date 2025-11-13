# PRP 05 · Subtasks & Progress Tracking

## Feature Overview
Subtasks let users break a todo into actionable checklist items while visual progress bars communicate completion state at a glance. Subtasks belong to a parent todo, inherit its security context, and must survive full CRUD lifecycle events (create, toggle, rename, delete) with real-time progress updates in the UI.

## User Stories
- **Busy Professional**: “As a productivity-focused user, I want to split a todo into smaller subtasks so I can check off incremental progress.”
- **Project Manager**: “As a manager, I need a progress indicator so I can quickly spot which todos are nearly done versus untouched.”
- **Returning User**: “As a returning user, I want subtasks to remain associated with their todo even if I edit titles or reorder items so my planning stays intact.”

## User Flow
1. User opens a todo and expands the Subtasks section.
2. User creates one or more subtasks via an input field (press Enter or click Add).
3. Application renders subtasks sorted by `position` with checkboxes for completion.
4. Toggling a checkbox updates the subtask `is_completed` flag and recalculates todo-level progress immediately.
5. Users can rename or delete subtasks; deletions update progress and the UI without a full refresh.
6. Deleting the parent todo removes all subtasks automatically via cascade behavior.

## Technical Requirements
- **Database Schema**
  - Table `subtasks` with fields: `id` (PK), `todo_id` (FK → todos.id ON DELETE CASCADE), `title` (TEXT, trimmed, non-empty), `position` (INTEGER, default 0), `is_completed` (INTEGER 0/1, default 0), `created_at`, `updated_at` (TEXT ISO strings in Singapore timezone).
  - Apply indexes on `todo_id` and `(todo_id, position)` for ordered retrieval.
  - All migrations live in `lib/db.ts`; use `try/catch` `ALTER TABLE` guards for backwards compatibility.
- **Type Definitions**
  - Extend exports in `lib/db.ts`: `interface Subtask { id: number; todoId: number; title: string; position: number; isCompleted: boolean; createdAt: string; updatedAt: string; }`.
  - Add helper `type ProgressStats = { completed: number; total: number; percent: number; };` for reuse in UI and API responses.
- **Database Operations (synchronous)**
  - `subtaskDB.create(todoId: number, title: string, position: number): Subtask`
  - `subtaskDB.updateTitle(id: number, title: string): Subtask`
  - `subtaskDB.toggleCompletion(id: number, isCompleted: boolean): Subtask`
  - `subtaskDB.delete(id: number): void`
  - `subtaskDB.listByTodo(todoId: number): Subtask[]` ordered by `position` ASC then `id` ASC.
  - Resync positions after deletion using a single transaction to avoid gaps (e.g., normalize sequential integers starting at 1).
- **API Routes (Next.js App Router)**
  - `POST /api/todos/[id]/subtasks`
  - `PUT /api/subtasks/[id]`
  - `PATCH /api/subtasks/[id]/toggle`
  - `DELETE /api/subtasks/[id]`
  - All routes call `await getSession()` first, return 401 if absent, and enforce `params` via `const { id } = await params`.
  - Return JSON payload containing updated todo progress: `{ subtask, progress }`.
- **Validation Rules**
  - Titles trimmed; empty titles return 400 with `{ error: 'Subtask title is required' }`.
  - Maximum 200 characters per title; enforce both server-side and via input `maxLength`.
  - Position must be a non-negative integer; fall back to `list.length + 1` if client omits value.
- **Progress Calculation**
  - `completed = subtasks.filter(s => s.isCompleted).length`.
  - `total = subtasks.length`.
  - `percent = total === 0 ? 0 : Math.round((completed / total) * 100)`.
  - Calculation occurs server-side after each mutation and client-side for immediate UI feedback; reconcile discrepancies by refetching canonical data.
- **Cascade Delete**
  - Ensure foreign key constraints are active (`PRAGMA foreign_keys = ON` in `lib/db.ts`).
  - Deleting a todo automatically removes all related subtasks; API should not manually delete child records.
- **Timezone Handling**
  - Whenever timestamps are stored, use `const now = getSingaporeNow();` from `lib/timezone.ts` and persist `now.toISOString()`.

## UI Components & UX
- **Subtask Section**: Collapsible panel within `app/page.tsx` (client component). Default collapsed when no subtasks exist.
- **Add Subtask Input**: Text input with placeholder (“Add a subtask…”). Enter key triggers creation; disable button while request pending to prevent duplicates.
- **Subtask Item**
  - Checkbox bound to `is_completed`.
  - Editable title (inline edit or modal). Use optimistic UI updates with rollback on error.
  - Delete button (icon) with confirmation tooltip.
  - Drag handle (optional stretch goal) for manual reordering; update `position` on drop.
- **Progress Bar**
  - Horizontal bar displaying percent; fill color blue by default, switches to green at 100%.
  - Text summary below bar: “`X/Y completed (Z%)`”. For 0 total, show “No subtasks yet”.
  - Accessible via ARIA attributes: `role="progressbar"`, `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`.
- **Loading & Error States**
  - Show inline spinner or skeleton while fetching subtasks.
  - Display error toast/snackbar using existing notification pattern on API failure.

## Edge Cases & Constraints
- Prevent duplicate subtasks by identical trimmed title for the same todo (case-insensitive check optional but recommended).
- Handle rapid toggling by debouncing UI updates or disabling checkbox while request in-flight.
- Ensure progress bar handles totals over 0 but with completed count 0 (show 0%).
- When last subtask is deleted, progress should reset to 0% and UI collapses (optional) without layout shift issues.
- Respect auth boundaries: users cannot mutate subtasks from todos they do not own (checked via `todo.user_id === session.userId`).
- Guard against stale todo IDs; return 404 if todo not found or belongs to another user.
- Normalize whitespace when saving titles to avoid hidden duplicates.

## Acceptance Criteria
- Users can add unlimited subtasks to any todo they own.
- Progress bar and count updates instantly after each mutation.
- Subtask completion state persists across reloads and sessions.
- Deleting a subtask updates positions and progress accurately.
- Deleting the parent todo removes associated subtasks without orphaned records.
- API endpoints reject invalid input with descriptive 4xx responses.
- Accessibility: Subtask controls keyboard-navigable; progress bar exposes ARIA metadata.

## Testing Requirements
- **Unit Tests**
  - Progress calculation (`completed`, `total`, `percent`) for 0, partial, and full completion scenarios.
  - Database helper tests for create/update/toggle/delete ensuring correct fields and cascade behavior.
  - Validation tests for blank titles, over-length titles, and invalid positions.
- **Playwright E2E**
  - Add multiple subtasks, verify ordering, and check progress bar values.
  - Toggle completion; ensure UI percent updates and persists after page reload.
  - Rename subtask and confirm changes reflect in list and backend.
  - Delete a subtask and verify positions renumber and percent recalculates.
  - Delete the parent todo and confirm subtasks no longer appear in database (optional via API or UI assertion).
  - Keyboard navigation: tab through subtasks, toggle via Enter/Space.

## Out of Scope
- Drag-and-drop reordering beyond simple position normalization (may be future enhancement).
- Subtask-level due dates or reminders.
- Bulk operations across multiple todos.
- Cross-user subtask sharing or assignments.

## Success Metrics
- 0 open bugs related to subtask CRUD or progress calculation after release.
- Playwright scenario “Subtasks and Progress” passes consistently (≥3 consecutive CI runs).
- User feedback: 90% of surveyed beta users report improved clarity on task completion.
- Time from subtask mutation to UI update < 200 ms (optimistic) / < 500 ms (pessimistic fallback).

## Developer Notes
- Maintain consistency with monolithic `app/page.tsx` architecture; integrate subtask state into existing React hooks and reducers.
- Use fetch wrappers already present in the app for API calls; include JWT session cookies automatically.
- Prefer immutable state updates to avoid React rendering bugs in large component.
- Keep all strings in English and reuse existing utility components (badges, toasts) for consistent styling.
