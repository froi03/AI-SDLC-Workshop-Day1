# PRP 03 · Recurring Todos

## Feature Overview
Recurring todos automatically regenerate after completion using predefined schedules (daily, weekly, monthly, yearly). The feature ensures continuity for routine tasks while maintaining metadata such as priority, reminders, tags, and subtasks.

## User Stories
- **Operations Lead**: “I need a weekly review task that reappears once I finish it so I never forget.”
- **Finance Manager**: “Monthly invoicing should recreate itself with the same settings every month.”
- **Habit Tracker**: “Daily habits should return immediately once marked done to keep streaks going.”

## User Flow
1. User creates or edits a todo, enabling the “Repeat this todo” option.
2. User selects a recurrence pattern (daily/weekly/monthly/yearly) and sets a due date.
3. The todo displays a recurrence badge in lists.
4. When the user marks the todo complete:
   - Current instance moves to Completed section with `completedAt` timestamp.
   - Backend creates the next occurrence with new `dueDate` based on pattern.
   - UI refreshes to show the new active todo.
5. User can disable recurrence at any time via edit form, stopping automatic regeneration.

## Technical Requirements
- **Database**
  - `todos` table fields already present: `is_recurring` (INTEGER 0/1) and `recurrence_pattern` (TEXT).
  - Ensure `recurrence_pattern` has a `CHECK` constraint for allowed values.
  - Store recurrence metadata on parent todo; no separate table required.
- **Types**
  - `type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';` exported from `lib/db.ts`.
- **API**
  - `POST /api/todos`: if `isRecurring` true, require valid `recurrencePattern` and `dueDate`.
  - `PUT /api/todos/[id]`: when toggling `isRecurring`, enforce same validations; dropping `dueDate` must automatically nullify `isRecurring`, `recurrencePattern`, `reminderMinutes`.
  - Completion handler (PUT with `isCompleted: true`)must trigger creation of new todo instance with inherited metadata.
- **Next Instance Creation Logic**
  - Use Singapore timezone functions (`getSingaporeNow`, `parseSingaporeDate`).
  - Determine next due date by adding 1 day/week/month/year to the completed instance’s due date in Singapore zone.
  - New todo copies: title, description, priority, reminder, tags (via tag relationship), subtasks templates? (subtasks may reset—optional; see Template feature for patterns).
  - Set `isRecurring` and `recurrencePattern` on new instance.
  - Reset `isCompleted=false`, `completedAt=null` in new instance.
- **Timezone Handling**
  - All calculations performed using `DateTime` in `Asia/Singapore` zone.
  - Edge case for due dates near midnight should respect Singapore date boundaries.

## UI Components & UX
- **Create/Edit Form**
  - Checkbox to enable recurrence.
  - Dropdown for pattern (Daily, Weekly, Monthly, Yearly).
  - Tooltips explaining each pattern and due date requirement.
  - Reminder dropdown remains available; disable if no due date.
- **Todo Card Badges**
  - Display `Repeats <pattern>` badge (e.g., “Repeats weekly”).
  - Use consistent styling with priority badges (bordered pill, blue/purple accent).
- **Completion Behavior**
  - When completed, show subtle toast (optional) indicating next instance created.
  - Completed todo remains in history for auditing.

## Edge Cases & Constraints
- Must have due date for recurring todos. Reject creation otherwise.
- Ensure recurrence pattern cannot be set without `isRecurring=true`.
- For monthly/yearly recurrences, handle short months (use Luxon’s `.plus({ months: 1 })` which adjusts automatically).
- Prevent infinite loops: creation of new instance happens once per completion; guard against repeated toggles by verifying todo is currently incomplete before generating.
- If user unchecks recurrence on an existing recurring todo, do not auto-create future instances.
- When updating due date of a recurring todo, future next instance should base on the updated due date.

## Acceptance Criteria
- Users can enable recurrence with four patterns and a due date.
- Completing a recurring todo immediately creates the next instance with inherited metadata.
- Next due date follows correct cadence in Singapore timezone (no off-by-one errors).
- Recurrence can be disabled without residual scheduled instances.
- API rejects invalid recurrence configurations with descriptive errors.

## Testing Requirements
- **Unit Tests**
  - Recurrence calculation utility: verify next due dates for each pattern, including edge dates (end of month, leap years).
  - API validation for missing due date or invalid patterns.
- **Playwright E2E**
  - Create recurring todo for each pattern; mark complete; confirm new todo appears with correct due date and metadata.
  - Disable recurrence and ensure no further instances generate.
  - Verify UI badge and sorting after generation.

## Out of Scope
- Custom recurrence patterns (every X days, weekdays only).
- Automatic creation at due date if not completed (strictly completion-triggered).
- Recurrence templates for subtasks beyond copying existing ones (extended via templates feature).

## Success Metrics
- 0 recurrence creation failures in backend logs during completion events.
- 100% of recurrence due dates validated against Singapore timezone in integration tests.
- User feedback indicates reduced manual re-entry for routine tasks.

## Developer Notes
- Keep recurrence logic in a dedicated helper (e.g., `lib/recurrence.ts`) for testability.
- Ensure new instance creation occurs within a transaction if additional associated records (tags, subtasks) are inserted to prevent partial state.
- Document recurrence behavior in `USER_GUIDE.md` to align with user expectations.
