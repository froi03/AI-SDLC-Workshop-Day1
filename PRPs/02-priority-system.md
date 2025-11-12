# Feature 02 – Priority System (PRP)

## Objective
- Introduce a three-level priority model (`high`, `medium`, `low`) for todos that influences ordering, visual emphasis, and filtering.
- Ensure priority metadata persists across API, database, UI, and integrations (recurring todos, templates, export/import).

## Background & Context
- Base CRUD feature (Feature 01) is assumed to exist with todos stored via `better-sqlite3` in `lib/db.ts` and rendered from `app/page.tsx` client component.
- Singapore timezone helpers in `lib/timezone.ts` remain mandatory for due-date comparisons when priority interacts with scheduling (e.g., sorting by due date within priority groups).
- Tailwind CSS 4 powers styling; any class names should conform to project conventions already present in `app/page.tsx`.

## User Stories
- "As a user, I want to mark urgent todos as high priority so they surface at the top of my list." 
- "As a planner, I need a visual indicator of task urgency to scan my list quickly." 
- "As someone managing many tasks, I want to filter by priority to focus on critical work first." 
- "As a teammate sharing exported todos, I want priority preserved so others see the same urgency." 

## Functional Requirements

### Data Model
- Add `priority` column to `todos` table (`TEXT NOT NULL DEFAULT 'medium'`).
- Enforce `CHECK` constraint limiting values to `high`, `medium`, `low` (or validate in code before insert/update).
- Update TypeScript types in `lib/db.ts`:
  - `export type Priority = 'high' | 'medium' | 'low';`
  - Extend `Todo` interface with `priority: Priority`.
  - Update CRUD methods to accept/return priority.
- Migration pattern: wrap `ALTER TABLE` in try/catch to avoid crashing when column already exists.

### API
- Modify `/api/todos` POST & PUT handlers to validate incoming `priority` (fallback to `'medium'` if invalid/omitted).
- Ensure GET responses include `priority` for todos.
- When duplicating or inheriting todos (recurring, templates, import), preserve priority.
- Include priority in export JSON/CSV payloads and import mapping logic.

### Client UI (`app/page.tsx`)
- Todo creation/edit form includes a priority selector (likely `<select>` with `High`, `Medium`, `Low`). Default selection: `Medium`.
- Priority badges displayed on todo cards:
  - High: red badge (ensure accessible contrast in light/dark modes).
  - Medium: yellow badge.
  - Low: blue badge.
- Tooltip or screen-reader text describing priority (e.g., `aria-label="High priority"`).
- Priority impacts ordering: sort todos by priority (High → Medium → Low), then by due date (earliest first), then by creation timestamp.
- Priority filter dropdown in filter bar: `All Priorities`, `High`, `Medium`, `Low`; integrates with broader filtering (Feature 08).
- Completed section retains priority badge for context.

### UX Details
- Indicate default `Medium` visually in selector.
- Adjust spacing so badge aligns with other metadata (recurrence, reminder, tags).
- Support keyboard navigation for dropdown.
- Ensure badges do not duplicate colors used for other labels (use consistent palette defined in README/USER_GUIDE).

## State Management
- Extend React state to track `priority` in creation/edit forms.
- Update filter state to include selected priority; integrate with memoized filtered lists.
- Ensure sorting logic uses priority order array (e.g., `const priorityOrder = { high: 0, medium: 1, low: 2 };`).

## Performance Considerations
- Sorting should occur client-side using memoized selectors to avoid recomputation on every render.
- API queries should include `ORDER BY` clause matching priority order to reduce client work if feasible.
- Validation should be synchronous (no async DB operations required beyond existing flow).

## Accessibility & Localization
- Provide `aria-label`s for priority selector and badges (e.g., `aria-label="High priority"`).
- Ensure badge colors meet WCAG AA contrast in both themes; add text fallback (e.g., `H`, `M`, `L`) for color-blind accessibility if necessary.
- Priority labels should be translatable strings (currently English; consider future i18n by isolating text constants).

## Edge Cases
- Missing `priority` defaults to `medium` on server and client.
- Invalid priority string in request should be rejected with `400` or coerced to default (decide and be consistent).
- Sorting must handle todos without due dates by placing them after those with due dates within same priority.
- Export/import should handle legacy files without priority (default to `medium`).
- Recurring todos must carry priority to new instance; confirm existing logic includes this field.

## Out of Scope
- Custom user-defined priority levels.
- Automatic priority adjustments based on due date or completion status.
- Priority-specific notifications beyond existing reminder system.

## QA & Testing Guidance
- Update Playwright specs to cover: creating todos with each priority, sorting order, filtering by priority, priority persistence after edit and completion, and export/import retention.
- Add unit tests (if present) to verify sorting helper and validation logic.
- Manually verify badge contrast in light/dark modes and responsive layouts.
```