# Feature 03 – Recurring Todos (PRP)

## Feature Overview
- Introduce first-class recurring scheduling so todos can automatically regenerate after completion on daily, weekly, monthly, or yearly cadences.
- Recurring metadata is visible everywhere the todo appears (forms, cards, calendar, exports) so users can distinguish repeating work from one-off tasks.
- New instances inherit the source todo’s configuration (priority, tags, reminders, subtasks, templates) while shifting due dates forward using Singapore timezone rules.

## User Stories
- “As someone managing routines, I want to mark a task as recurring so the system auto-creates the next occurrence when I finish it.”
- “As a user reviewing my dashboard, I need a clear 🔄 badge that tells me which todos will return so I can plan capacity.”
- “As a template author, I want recurring settings saved in templates so my weekly reports spawn with the right cadence out of the box.”
- “As an exporter, I expect recurring metadata preserved so teammates understand which tasks repeat.”

## User Flow
1. User opens the Create Todo form in `app/page.tsx`.
2. User toggles the “Repeat this todo” checkbox, which reveals recurrence pattern and reminder selectors.
3. User selects a pattern (daily/weekly/monthly/yearly) and sets a due date (required for recursion).
4. When the user completes the todo (checkbox), the backend generates a new row with updated due date while the completed instance moves to the history section.
5. The UI refreshes, showing the successor todo with the same priority, reminder, tags, and subtasks, plus a 🔄 badge indicating its pattern.

## Technical Requirements

### Database Schema (`lib/db.ts`)
- `todos` table already includes `is_recurring INTEGER` and `recurrence_pattern TEXT`; enforce acceptable values (`daily|weekly|monthly|yearly`) when creating or updating.
- When cloning for the next occurrence, reuse existing `priority`, `tags` (via `todo_tags`), `subtasks`, `reminder_minutes`, and `description`.
- Ensure timestamps use `getSingaporeNow()` so audit trails remain consistent.

### Backend Logic (`app/api/todos/[id]/route.ts`)
- PUT handler must validate:
  - `isRecurring` is boolean.
  - When `isRecurring === true`, `dueDate` cannot be null and `recurrencePattern` must be one of the four enums.
  - Unsetting `dueDate` automatically clears recurrence/reminder fields.
- On completion (`isCompleted` flips to true) and `existing.isRecurring`, create the successor todo in the same transaction-like block:
  - Calculate next due date according to pattern using Singapore timezone (e.g., `daily` +1 day, `weekly` +1 week, `monthly` +1 calendar month preserving day or clamping to valid end-of-month, `yearly` +1 year).
  - Preserve reminder offset, priority, tags, and subtasks ordering.
  - Reset completion status for the new record.
- Return updated todo in response and ensure API never leaks null/undefined pattern values (use `null` explicitly).

### Backend Logic (`app/api/todos/route.ts`)
- POST handler must require a future due date when `isRecurring` checks true and reject invalid patterns with a 400 response.
- Normalize reminder options via `REMINDER_OPTIONS` constant and block reminder assignment if no due date supplied.

### Client Logic (`app/page.tsx`)
- Maintain `createForm.isRecurring` and `createForm.recurrencePattern` state with default pattern `daily` when toggled on.
- Show recurrence and reminder dropdowns only when relevant; disable reminder dropdown if no due date specified (mirroring current UX).
- Display a 🔄 badge (`Repeats {pattern}`) for any todo with `isRecurring` true to reinforce recurrence.
- During optimistic updates (create/edit/toggle), ensure cloned todos keep recurrence metadata so UI does not flicker.
- When editing, ensure toggling off recurrence clears pattern/reminder fields and sets `isRecurring` false before sending payload.

### Timezone Handling (`lib/timezone.ts`)
- Use `getSingaporeNow()` and `DateTime` calculations with `'Asia/Singapore'` zone for all recurrence math—never rely on `new Date()`.
- Provide helper utilities if necessary (e.g., `calculateNextDueDate(currentDueDate, pattern)`) to encapsulate timezone-safe increments and end-of-month handling.

### Integration Points
- **Templates**: `templates` table must store recurrence information so `POST /api/templates/[id]/use` recreates todos with the same pattern and `is_recurring` flag.
- **Export/Import**: JSON and CSV exports include `is_recurring` and `recurrence_pattern`; import defaults to `isRecurring=false` if fields missing and validates enums if provided.
- **Calendar View**: Recurring todos should appear on the correct due date after regeneration; ensure UI re-render picks up new due dates.
- **Notifications**: Reminder scheduling should carry over to regenerated todos.

## UI Components
- **Create/Edit Forms**: Checkbox labelled “Repeat this todo”; when enabled, reveal pattern select (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`) and reminder dropdown. Disable reminder select when no due date is chosen.
- **Todo Cards**: Add `Repeats {pattern}` badge next to priority badge using Tailwind utility classes from existing implementation (`border-blue-500/40`, `text-blue-300`).
- **Completed Section**: Completed recurring todos retain badges to convey recurrence history.
- **Template Modal**: Show recurrence badge and pattern in template previews so users can differentiate repeating templates at a glance.

## Edge Cases
- Disallow recurring todos without due dates or with due dates in the past (server-side validation returning HTTP 400).
- When toggling `isRecurring` from true to false, ensure backend clears `recurrence_pattern`, `reminder_minutes`, and does not spawn successors.
- Monthly/yearly increments must respect Singapore calendar specifics (e.g., Jan 31 + 1 month → Feb 29/28 depending on leap year, using Luxon’s `plus` with `zone` set).
- Prevent duplicate successor creation if PUT request retried—guard by checking completion timestamps or idempotent logic.
- If reminder offset pushes successor reminder into the past, allow creation but reminder system should still evaluate relative to new due date.

## Acceptance Criteria
- Users cannot enable recurrence without supplying a valid future due date and pattern; API enforces this with descriptive errors.
- Completing a recurring todo generates exactly one successor with adjusted due date, preserving priority, tags, reminder, description, and subtasks.
- Recurring badge accurately reflects pattern on all UI surfaces (main list, modals, templates, exports, calendar).
- Import/export round-trips retain recurrence metadata without validation errors.
- Templates created from recurring todos reproduce recurrence settings when used to generate new todos.

## Testing Requirements
- **Playwright**:
  - Create todos for each pattern and verify badge rendering plus regeneration upon completion.
  - Validate that attempting to enable recurrence without due date triggers visible client/server error messaging.
  - Confirm reminders persist on regenerated instances.
  - Ensure calendar view shows successor on expected date after completion (if calendar feature active).
- **API Tests** (if implemented):
  - POST rejects `isRecurring: true` when `dueDate` missing or past.
  - PUT completion spawns successor with correct due date increments and inherited fields.
  - PUT with `isRecurring: false` clears recurrence metadata.
- **Unit Tests** (timezone helpers):
  - `calculateNextDueDate` handles month-end transitions and leap years in Singapore zone.

## Out of Scope
- Custom recurrence intervals (e.g., every 2 weeks) or weekday-specific schedules.
- Pausing or skipping single occurrences without completion.
- Bulk actions to toggle recurrence across multiple todos simultaneously.
- Automatic reminder recalculation beyond copying existing offsets.

## Success Metrics
- 100% of recurring completions create the next occurrence without duplicate rows.
- No validation regressions in Playwright suite covering recurring edge cases.
- Export/import smoke tests confirm recurrence metadata fidelity.
- User-facing bug reports related to recurrence drop after release, indicating predictable behavior.
