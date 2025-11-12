# Feature 09 – Export & Import (PRP)

## Objective
- Enable users to back up their todos, subtasks, and tag relationships to a portable JSON file and optionally analyze data in CSV format.
- Allow users to restore data from a previously exported JSON file while preserving relationships and preventing duplication.

## Background & Context
- The application is a Next.js 16 App Router project with SQLite (`better-sqlite3`) persistence and WebAuthn authentication.
- Existing API routes in `app/api/todos/export` (GET) and `app/api/todos/import` (POST) must conform to the auth/session pattern (`getSession()` guard).
- Singapore timezone rules (via `lib/timezone.ts`) apply to all datetime serialization/deserialization; avoid raw `new Date()`.
- Export/Import should align with current UI expectations (buttons located in main todo page toolbar per README/USER_GUIDE).

## User Stories
- "As a power user, I want to export my todos with subtasks and tags so I can store a backup outside the app." 
- "As a team member sharing templates, I want to export a collection of todos and import them into another account without recreating each item." 
- "As an analyst, I want a CSV export so I can review completion patterns in spreadsheet tools." 
- "As a returning user, I want to import a previous backup and see all my todos restored with correct metadata." 

## Functional Requirements

### Export JSON (`GET /api/todos/export`)
- Authenticated endpoint guarded by `getSession()`; return `401` for unauthenticated requests.
- Response body: JSON payload with top-level structure `{ version: string, exported_at: string, todos: TodoExport[], tags: TagExport[] }`.
- Include todos owned by the session user, each with:
  - `id` (original ID for reference), `title`, `description` (if present), `priority`, `is_completed`, `due_date` (ISO string or `null`), `is_recurring`, `recurrence_pattern`, `reminder_minutes`, `created_at`, `updated_at`.
  - Embedded `subtasks` array: `[{ id, title, position, is_completed, created_at, updated_at }]`.
  - Embedded `tagIds`: array of associated tag IDs.
- `tags` array includes tag metadata (`id`, `name`, `color`, `created_at`, `updated_at`).
- Serialize dates in ISO 8601 using Singapore timezone utilities (ensure stored timestamps convert consistently).
- Set appropriate headers: `Content-Type: application/json`, `Content-Disposition: attachment; filename="todos-YYYY-MM-DD.json"` (date computed in Singapore timezone).

### Export CSV (optional but documented)
- Same authentication guard.
- Flatten todo data into CSV columns (e.g., `id,title,description,priority,is_completed,due_date,is_recurring,recurrence_pattern,reminder_minutes,created_at,updated_at,tag_names,subtask_titles`).
- Join multiple tag names/subtask titles with semicolons.
- Use `Content-Type: text/csv` and `Content-Disposition` similar to JSON export.
- Confirm CSV feature gating (if not implemented, document as future work); ensure UI only shows enabled options.

### Import JSON (`POST /api/todos/import`)
- Auth guard identical to export.
- Accept `application/json` body or uploaded file parsed client-side and sent as JSON.
- Validate payload shape and version before processing; reject with `400` for invalid/missing fields.
- Map incoming IDs to new IDs to avoid collisions:
  - Build `tagIdMap` keyed by source ID; reuse existing tag if name matches (case-insensitive) or create new tag.
  - For each todo, create new record for session user; record new todo ID in `todoIdMap`.
  - Recreate subtasks with new IDs linked to new todo.
  - Recreate tag associations using mapped tag IDs.
- Preserve metadata when available: priority defaults to `medium`, booleans default to `false`, `reminder_minutes` to `null` when absent.
- Ensure due dates converted using timezone helpers; handle `null` gracefully.
- Wrap DB operations in transaction to ensure all-or-nothing (use `better-sqlite3` transaction helper).
- Return summary response `{ importedTodos: number, importedSubtasks: number, importedTags: number, reusedTags: number }`.

### Client UI (in `app/page.tsx`)
- Export buttons grouped in toolbar: `Export JSON`, optional `Export CSV`.
- Import button opens file picker restricted to `.json`; read file client-side, show confirmation modal summarizing counts before POST (if feasible).
- Optimistically refresh todo list after successful import; display toast/snackbar with summary counts.
- Show error toast on failure with actionable message (e.g., "Invalid file format").

## Data & Validation
- JSON schema alignment: ensure required fields; optional fields handled with defaults.
- Limit import payload size (e.g., `5 MB`) to guard against huge files; respond with `413` if exceeded.
- Detect duplicate titles/todos gracefully (allow duplicates; system distinguishes by new IDs).
- Sanitize string fields (trim, enforce length constraints consistent with existing creation forms).

## State Management
- Client keeps no persistent state beyond existing todo list; saved export/import data not stored.
- Store import summary in component state to render confirmation and toast.
- For CSV export, no additional state beyond request in-flight status.

## Performance Considerations
- Export queries should use prepared statements with user ID filters to avoid scanning entire tables.
- Import transaction should batch inserts using prepared statements to maintain performance (target <500 ms for 100 todos).
- Avoid blocking UI during large imports; show loading indicator/spinner while request in progress.

## Security & Privacy
- Ensure exports include only data for authenticated user (no leakage across users).
- Treat imported files as untrusted input; perform server-side validation and reject unexpected structures.
- Do not log sensitive content (todo titles) during import/export operations.
- `Content-Disposition` filenames should avoid user-provided strings to prevent injection.

## Edge Cases
- Empty dataset export should still return valid JSON with empty arrays and downloadable file.
- Importing file with zero todos should succeed and return zero counts.
- If tags already exist with same name but different color, decide whether to reuse existing (prefer reuse, keep existing color) or create new; document behavior clearly.
- If import encounters partially invalid record (e.g., bad subtask), fail transaction and return validation error rather than partial import.
- Handle legacy export versions (if schema evolves): include `version` field and implement backward compatibility strategy.

## Out of Scope
- Selective export/import (e.g., subset by filter).
- Scheduled automatic backups.
- Importing from CSV.
- Merging remote data via API (only file-based). 

## QA & Testing Guidance
- Playwright E2E: export workflow (initiates download), import valid file (creates expected todos), import invalid file (shows error), import file with existing tag names (reuses tags), verify UI refresh.
- Unit tests for server handlers: validation errors, tag reuse logic, transaction rollback on failure, date conversions.
- Manual test for large dataset (≈500 todos) to ensure performance and UI responsiveness.
- Confirm timezone correctness by exporting/importing todos with due dates around midnight Singapore time.
- Verify behavior in supported browsers (Chrome/Edge, Firefox, Safari) per project standards and in both light/dark modes.
