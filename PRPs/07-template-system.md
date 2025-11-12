# PRP 07 · Template System

## Feature Overview
The Template System allows users to save frequently used todo configurations and quickly instantiate new todos that replicate titles, metadata, tags, and subtasks. Templates are user-specific, include optional descriptions and categories, and store subtask definitions as JSON so they can be reproduced on demand.

## User Stories
- **Routine Planner**: "As a user managing recurring workflows, I want to save a configured todo as a template so I can recreate it without re-entering details."
- **Team Coordinator**: "As a coordinator, I need to categorize templates (e.g., Onboarding, Marketing) to quickly locate the right one during busy schedules."
- **Power User**: "As a power user, I want templates to pre-populate subtasks and tags when applied so I maintain consistency across repeated tasks."

## User Flow
1. User configures a todo (title, priority, due date, tags, subtasks, reminder, recurrence) and clicks "Save as Template".
2. A modal prompts for template name, optional description, and category selection/creation.
3. Template persists and appears in the Manage Templates list, grouped by category.
4. When creating a new todo, user clicks "Use Template", selects a template, optionally adjusts due date offset (e.g., +3 days), and confirms.
5. The app creates a new todo with inherited metadata, subtasks, and tags; the UI highlights the newly created todo.
6. Users can edit or delete templates; deleting does not affect existing todos created from them.

## Technical Requirements
- **Database Schema**
  - `templates` table: `id` (PK), `user_id` (FK → users.id ON DELETE CASCADE), `name` (TEXT, trimmed, unique per user), `description` (TEXT, nullable), `category` (TEXT, nullable), `priority` (TEXT enum), `recurrence_pattern` (TEXT enum or null), `reminder_minutes` (INTEGER nullable), `due_offset_days` (INTEGER, default 0), `tags` (TEXT JSON array of tag IDs), `subtasks` (TEXT JSON array), `created_at`, `updated_at` (ISO strings via Singapore timezone).
  - Use JSON structure for subtasks: `[ { "title": string, "position": number } ]`.
  - Consider additional column `estimated_duration_minutes` (optional, default null) for future enhancements; leave null if unused.
  - Indexes: `CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);` and `CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(user_id, category);`.
- **Type Definitions**
  - In `lib/db.ts`, add `interface Template { id: number; userId: number; name: string; description: string | null; category: string | null; priority: Priority; recurrencePattern: RecurrencePattern | null; reminderMinutes: number | null; dueOffsetDays: number; tagIds: number[]; subtasks: Array<{ title: string; position: number }>; createdAt: string; updatedAt: string; }`
  - Export helper `interface TemplateSummary extends Template { usageCount: number; }` for analytics (optional).
- **Database Operations (synchronous)**
  - `templateDB.list(userId: number): Template[]` sorted by category then name.
  - `templateDB.create(userId: number, payload: TemplateInput): Template`
  - `templateDB.update(id: number, userId: number, payload: Partial<TemplateInput>): Template`
  - `templateDB.delete(id: number, userId: number): void`
  - `templateDB.get(id: number, userId: number): Template | undefined`
  - `templateDB.use(id: number, userId: number, options: { dueDate?: string | null; dueOffsetDays?: number | null }): { todo: Todo; subtasks: Subtask[]; tags: Tag[] }`
  - `TemplateInput` captures name, description, category, priority, recurrencePattern, reminderMinutes, dueOffsetDays, tagIds, subtasks.
- **Serialization Rules**
  - `tags` column stores serialized JSON array of numeric IDs; ensure parsing uses `JSON.parse` with fallback to `[]`.
  - `subtasks` column stores array of objects with sanitized titles and positive integer positions.
  - Maintain stable ordering by position when writing JSON.
- **API Routes**
  - `GET /api/templates` → returns `{ templates: Template[] }` for authenticated user.
  - `POST /api/templates` → body `{ name, description?, category?, priority, recurrencePattern?, reminderMinutes?, dueOffsetDays?, tagIds?, subtasks? }`.
  - `PUT /api/templates/[id]` → updates template fields; returns `{ template }`.
  - `DELETE /api/templates/[id]` → removes template; returns `{ success: true }`.
  - `POST /api/templates/[id]/use` → body optionally includes `{ dueDate, dueOffsetDays }`; creates todo + relations and responds `{ todo, subtasks, tags }`.
  - All routes enforce session via `await getSession()`, validate ownership, and respond with descriptive 4xx errors on invalid input.
- **Validation Rules**
  - Template name trimmed, required, max 80 characters, unique per user (case-insensitive).
  - Category trimmed, max 40 characters; allow null to represent "Uncategorized".
  - Due offset: integer ≥ 0; default 0 (same day). Validate that either a specific `dueDate` is provided or `dueOffsetDays` is used when instantiating.
  - Subtask titles trimmed, required if provided, max 200 characters; positions unique within template.
  - Tag IDs validated against user's tags; drop invalid IDs with warning (optionally return 400).
  - Reminder minutes must match supported offsets (15, 30, 60, 120, 1440, 2880, 10080) or null.
  - Recurrence pattern (if provided) must match `daily|weekly|monthly|yearly` and due date must be determinable.
- **Todo Creation from Template**
  - Determine due date: prioritize explicit `dueDate` from request; otherwise compute `getSingaporeNow()` plus `dueOffsetDays` using timezone-aware helpers.
  - Create todo with same priority, recurrence, reminder, and tags; handle recurring logic consistent with existing PUT handler.
  - Insert subtasks using stored titles/positions; mark all as incomplete by default.
  - Return full todo payload with tags/subtasks to update frontend state without refetch.
- **Timezone Handling**
  - Use `getSingaporeNow()` for template timestamps and due date calculations.

## UI Components & UX
- **Save as Template Modal**
  - Trigger button on todo detail card or actions menu.
  - Fields: template name (required), description, category (dropdown with free text entry), due offset (numeric input in days).
  - Default category to "General" or blank; allow user to create new category inline.
  - Show preview summary of what will be saved (priority, tags count, subtask count).
- **Manage Templates Modal/Page**
  - List templates grouped by category headers.
  - Show metadata badges (priority icon, recurrence, reminder, tags count, subtasks count).
  - Actions: Use, Edit, Delete. Edit opens modal with existing values; Delete requires confirmation dialog.
- **Use Template Flow**
  - Modal lists templates (searchable by name/category). Clicking one shows preview including subtasks.
  - Provide optional due date picker or offset override before confirming.
  - After creation, highlight new todo and optionally scroll into view.
- **Accessibility & UX**
  - Modal focus management, keyboard navigation, `aria-describedby` for descriptions.
  - Provide success/error toasts using existing system.
  - Ensure template badges meet color contrast requirements.

## Edge Cases & Constraints
- Prevent duplicate template names per user (case-insensitive).
  - When deleting a template that no longer exists (stale state), return 404 gracefully.
  - If tags referenced by template are deleted later, handle gracefully on use: skip missing tag IDs, log warning, and inform user via toast ("Some tags no longer exist; template applied without them").
  - Subtasks with blank titles should be filtered out before saving; notify user if all subtasks become empty.
  - When applying template with recurrence but no due date, require user to set due date or offset (cannot instantiate recurring todo without due date).
  - Large subtask lists (e.g., >50) should still render efficiently; consider virtualization if necessary.

## Acceptance Criteria
- Users can save existing todos as templates with name/category/description.
  - Users can list, search, edit, and delete templates they own.
  - Instantiating a template creates a todo with identical metadata, tags, and subtasks (positions preserved, all unchecked).
  - Due date respects specified offset or explicit date and uses Singapore timezone.
  - Templates gracefully handle missing tags or invalid data without crashing, providing user feedback.
  - API enforces ownership and validation rules, returning descriptive errors (400/404/409).
  - Accessibility requirements met for all modal interactions.

## Testing Requirements
- **Unit Tests**
  - Template serialization/deserialization (tags, subtasks) and validation helpers.
  - Due date calculation with offsets (0-day, >0 days) using `getSingaporeNow()` baseline.
  - Template usage flow ensuring new todo inherits metadata and cross-checks with existing recurrence logic.
  - Ensure duplicate template names raise conflict errors.
- **Playwright E2E**
  - Save a todo as template; verify template appears in list with correct metadata.
  - Use template to create new todo; confirm tags and subtasks appear correctly and progress is reset.
  - Edit template name/category; ensure list updates and new todo instantiation reflects changes.
  - Delete template; confirm removal from list and subsequent uses fail with clear error.
  - Apply template after deleting one of its tags; ensure warning displayed and todo created without missing tag.
  - Validate due offset: create template with offset 3 days; instantiate and confirm due date matches expectation in Singapore timezone.

## Out of Scope
- Sharing templates between users or exporting/importing templates independently of todos.
  - Versioning templates or tracking history of changes.
  - Auto-suggesting templates based on todo patterns.
  - Bulk applying templates to multiple todos simultaneously.

## Success Metrics
- ≥90% of beta users report time saved when creating recurring workflows (survey).
  - Template-related Playwright suite passes 3 consecutive CI runs.
  - No production incidents involving corrupted template JSON data within first release cycle.
  - Average template instantiation latency < 250 ms (DB + API).

## Developer Notes
- Centralize template logic in `lib/db.ts` to avoid spreading JSON parsing across the codebase.
  - Reuse existing form components and validation utilities to maintain consistency.
  - Update `USER_GUIDE.md` and marketing copy to highlight template functionality once implemented.
  - Ensure imports respect client/server boundaries: API routes handle DB access, while `app/page.tsx` uses fetch calls.
