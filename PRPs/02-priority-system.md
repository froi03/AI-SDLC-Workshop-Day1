# PRP 02 · Priority System

## Feature Overview
Priority levels help users identify which todos require immediate attention. The system introduces three priority bands (high, medium, low) with visual badges, sorting rules, and filtering options that affect both UI presentation and API validation.

## User Stories
- **Busy Professional**: “I want critical tasks to stand out so I don’t miss deadlines.”
- **Planner**: “I need to filter todos by importance to focus on a single priority at a time.”
- **Team Lead**: “I expect color cues to quickly understand what deserves escalation.”

## User Flow
1. User opens the Create Todo form and selects a priority (default: medium).
2. UI displays the priority badge immediately for the new todo.
3. Todos in the Active and Overdue lists sort by priority rank (high → medium → low), then by due date, then by creation order.
4. User edits an existing todo to change priority; the UI updates badges, sorting order, and filters.
5. User applies a priority filter to view only todos with a specific priority level.

## Technical Requirements
- **Database**
  - Column `priority` already exists in `todos` table; ensure `CHECK` constraint: `priority IN ('high','medium','low')`.
  - Default value `medium` for new records.
  - Add index on `(user_id, priority)` if necessary for filtering (optional based on query performance).
- **Types**
  - `type Priority = 'high' | 'medium' | 'low';` exported from `lib/db.ts`.
- **API Validation**
  - `POST /api/todos` and `PUT /api/todos/[id]` must validate the provided priority against the allowed set.
  - Requests without priority should fallback to `'medium'`.
- **Sorting Logic**
  - Server-side: `todoDB.listByUser` order by `is_completed`, then custom priority rank, then due date.
  - Client-side: `groupTodos` maintains same rank order for reactive updates.
- **Filtering API**
  - No dedicated endpoint; UI filters client-side using fetched data.
- **Timezone**
  - Sorting remains aware of due dates in Singapore timezone (already handled by core feature).

## UI Components & UX
- Priority dropdown in Create/Edit forms with uppercase labels and descriptive tooltips (optional).
- Badges on todo cards with Tailwind classes or inline styles reflecting project color palette:
  - High: red `#ef4444`
  - Medium: amber `#f59e0b`
  - Low: blue `#3b82f6`
- Badges should be accessible (text uppercase, minimum contrast 4.5:1).
- Filters section (chips or dropdown) allowing selection of a single priority (All/High/Medium/Low).
- Visual feedback when filter active: show pill with “Priority: HIGH” and clear button.

## Edge Cases & Constraints
- Reject invalid priority values with HTTP 400.
- Ensure badge text remains visible in dark mode.
- When editing priority, keep todo in same section but re-run sorting to reflect new order.
- Filtering combined with other filters (tags/search) must use AND logic.
- Avoid storing priority casing variations; server normalizes to lowercase strings.

## Acceptance Criteria
- Users can assign priority during create and edit flows.
- Todos display color-coded badges reflecting current priority.
- Active/Overdue todos sort high→medium→low and then by due date.
- Priority filter toggles results correctly without page reload.
- API rejects invalid priority values with descriptive error messages.

## Testing Requirements
- **Unit Tests**
  - Priority validation helper (allowed vs. invalid values).
  - Sorting function verifying expected order for sample dataset.
- **Playwright E2E**
  - Create todos with each priority; verify badges and ordering.
  - Edit a todo to change priority; confirm badge update and reordering.
  - Apply priority filter; ensure only matching todos appear.
  - Combine priority filter with tag or search filter for AND logic.
  - Visual regression (optional) to confirm contrast in light/dark mode.

## Out of Scope
- Custom priority levels beyond the three defaults.
- Bulk priority updates.
- Priority-specific notifications (covered by reminders feature).

## Success Metrics
- 100% of newly created todos persist a valid priority.
- Priority filter latency < 100 ms for 500 todos in client state.
- Zero accessibility violations related to priority badges (axe scan).

## Developer Notes
- Reuse Tailwind utility classes or existing inline styles for badges to maintain consistent theming.
- Keep priority enumerations synchronized across frontend and backend to avoid drift.
- When updating types, ensure `app/page.tsx` imports remain correct (avoid circular dependencies).
