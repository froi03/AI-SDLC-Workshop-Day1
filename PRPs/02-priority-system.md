# Feature 02 – Priority System (PRP)

## Feature Overview
- Introduce first-class priority metadata (`high`, `medium`, `low`) for every todo so urgency is communicated everywhere (forms, cards, filters, exports).
- Priorities drive default ordering (high → medium → low) while still respecting due dates and creation timestamps as secondary sort keys.
- Visual styling (badges, color coding) follows Tailwind CSS 4 conventions from `app/page.tsx` and accommodates light/dark mode as described in `USER_GUIDE.md`.
- Priority values move through the full stack: database (`better-sqlite3`), API routes, client state, recurring/task templates, and export/import pipelines.

## User Stories
- “As a busy professional, I want to mark urgent tasks as **High priority** so they appear at the top of my list.”
- “As someone scanning a long backlog, I need color-coded priority badges so I can distinguish importance at a glance.”
- “As a planner, I want to filter todos by priority so I can focus on high-impact work first.”
- “As a collaborator sharing data via export, I need the priority field preserved so recipients understand task urgency.”

## User Flow
1. User opens the todo form in `app/page.tsx`; the priority selector defaults to **Medium** and offers **High** and **Low** options.
2. Upon creation, the todo card renders with a color-coded badge (red/yellow/blue) and is inserted in the correct position according to priority then due date.
3. Users adjust priority via the edit modal; the change immediately impacts badge color, ordering, and any open filters.
4. Filters section includes an “All Priorities” dropdown. Selecting a value narrows all sections (Overdue, Pending, Completed) while maintaining counts as explained in `USER_GUIDE.md`.
5. When a todo becomes recurring, exported, duplicated from a template, or imported, the priority value is carried over so UX remains consistent across features.

## Technical Requirements

### Database Schema (`lib/db.ts`)
- Add a `priority TEXT NOT NULL DEFAULT 'medium'` column to the `todos` table with a `CHECK` or validation guard limiting values to `high`, `medium`, or `low`.
- Update shared types (`Priority`, `Todo`, DTOs) and CRUD helpers to accept and return priority.
- Follow existing migration style: wrap `ALTER TABLE` in a `try/catch` during `db.exec()` to avoid runtime failures when column already exists.

### API Contracts
- `POST /api/todos` and `PUT /api/todos/[id]` validate `priority`; coerce invalid values to `'medium'` or respond with `400` (pick one approach and stay consistent).
- `GET` endpoints return priority in every todo payload so the client can render badges without extra lookups.
- When cloning todos (recurring completion handler, template usage, import), copy the original priority.
- Export endpoints include priority in both JSON and CSV (see formats in `USER_GUIDE.md`), and import logic defaults to `'medium'` when a legacy file omits the field.

### Client Logic (`app/page.tsx`)
- Extend form state (`useState`/`useReducer`) for create/edit flows to include `priority`. Default to `'medium'` and validate before calling the API.
- Priority influences sorting: create an order map (`{ high: 0, medium: 1, low: 2 }`) used with due date (earliest first, `null` last) and creation time as tertiary key.
- Filter context/state gains a `priorityFilter` value. Filtering should apply before section rendering so counts (Overdue/Pending/Completed) stay accurate.
- Memoize sorting and filtering selectors (`useMemo`) to avoid unnecessary recomputations when unrelated state changes.

### Styling & Accessibility
- Use Tailwind utility classes matching the palette documented in the README (e.g., high: `bg-red-500`, medium: `bg-amber-500`, low: `bg-blue-500`). Provide dark-mode adjustments (e.g., `dark:bg-red-400`).
- Add accessible labels (e.g., `aria-label="High priority"`) or visually hidden text for screen readers. Colors alone must not convey meaning.
- Preserve consistent spacing with other badges (recurrence 🔄, reminders 🔔, tags) so layouts remain aligned on desktop and mobile.

### Integrations with Other Features
- **Recurring todos**: Ensure the PUT handler that spawns the next instance copies priority unchanged.
- **Templates**: Store `priority` in template definitions so creating from template sets the correct value instantly.
- **Export/Import**: Including priority is mandatory; apply defaults when missing.
- **Search & Filtering (Feature 08)**: Confirm combined filters (search, tags, priority) use AND semantics, matching the behavior described in `USER_GUIDE.md`.

## UI Components
- **Todo Form**: Dropdown or segmented control with labels High/Medium/Low. Default selection visually emphasized. Disabled state mirrors other inputs.
- **Todo Cards**: Badge precedes recurrence/reminder/tag badges. Colors (red/yellow/blue) adapt in dark mode, as explained in the guide.
- **Filter Bar**: “All Priorities” dropdown near search and tag filters; selecting a value updates counts and sections in real-time.
- **Completed Section**: Maintain priority badges so context is retained even after completion.
- **Modal Dialogs**: Edit modal includes priority selector consistent with create form. Template manager preview displays stored priority badge.

## Edge Cases
- Requests with missing priority default to `'medium'` both server-side and client-side for backward compatibility.
- Invalid values (e.g., `'urgent'`) must not reach the database; respond with `400` or coerce to default.
- Sorting must place todos with no due date after those with a due date but still respect priority ordering.
- Legacy export files without priority field should import with `'medium'` and succeed.
- Ensure badge colors meet WCAG AA contrast in both themes; add textual fallback (e.g., `H`, `M`, `L`) if contrast cannot be achieved.

## Acceptance Criteria
- Creating, editing, and viewing todos shows the priority selector/badge with correct defaults and colors.
- Todos appear sorted by priority, then due date, then creation timestamp, matching README expectations.
- Priority filter narrows todo lists across all sections and surfaces “Clear All” when active.
- Saved templates, recurring instances, exports, and imports retain priority values.
- API responses and database rows match the updated schema and reject invalid priorities.

## Testing Requirements
- **Playwright**: Extend CRUD specs to cover creating todos with each priority, verifying badge colors in UI, confirming sorting order, and testing priority filters (alone and combined with tags/search).
- **API Tests** (if present): Validate POST/PUT rejects invalid priority or defaults appropriately; ensure GET returns the field.
- **Manual QA**: Check light/dark mode contrast, screen reader labels, responsive layout (desktop/tablet/mobile), and import/export round-trips with legacy files.

## Out of Scope
- User-defined priority levels or dynamic extensions.
- Auto-priority adjustments based on due dates, reminders, or analytics.
- Priority-specific notification rules beyond existing reminder system.

## Success Metrics
- 100% of new todos include a priority value on creation.
- Sorting and filter logic produce zero regressions in existing E2E suites.
- Export/import round-trip retains identical priority distribution.
- Accessibility audits confirm badges meet contrast requirements and are announced by screen readers.
```