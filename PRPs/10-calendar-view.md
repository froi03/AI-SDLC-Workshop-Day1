# Feature 10 – Calendar View (PRP)

## Objective
- Provide a monthly calendar interface that visualizes todos by due date, highlights Singapore public holidays, and supports navigation across months while respecting the project’s timezone and styling conventions.

## Background & Context
- The application uses Next.js 16 App Router; `/calendar` is a client page protected by `middleware.ts` (requires authenticated session).
- Due dates and holiday calculations must use helpers from `lib/timezone.ts` (`getSingaporeNow`, `formatSingaporeDate`, etc.).
- Holiday data resides in the SQLite `holidays` table (seeded via `scripts/seed-holidays.ts`); API access provided via `app/api/holidays`.
- Main todo list state lives in `app/page.tsx`; calendar view pulls todos via API (reuse existing endpoints or add dedicated read API if needed).

## User Stories
- "As a user, I want to see all my todos laid out on a monthly calendar so I can plan my week." 
- "As someone observing Singapore holidays, I want those dates highlighted so I avoid scheduling conflicts." 
- "As a planner, I want to navigate between months quickly to review upcoming deadlines." 
- "As a busy user, I need to click a day and see the todos due on that date without leaving the calendar." 

## Functional Requirements

### Calendar Structure
- Default view loads current month (Singapore time). Use `getSingaporeNow()` to determine today.
- Display month/year header with navigation controls:
  - `Prev` button: moves to previous month.
  - `Next` button: moves to next month.
  - `Today` button: returns to current month.
- Show day-of-week headers (`Sun`–`Sat`), matching Singapore calendar conventions (weeks start on Sunday).
- Render calendar grid with leading/trailing days to fill complete weeks (typically 5–6 rows).
- Highlight current day with distinct styling.

### Holiday Integration
- Fetch holidays for displayed month via `/api/holidays?month=YYYY-MM` or fetch all and filter client-side (optimize as needed).
- Holidays should show name (tooltip or inline label) and special styling (e.g., colored dot/badge).
- Public holidays must be specific to Singapore (seed data ensures this). Ensure duplicates are not shown when navigating months.

### Todo Visualization
- Query todos once for active month (e.g., `/api/todos?from=YYYY-MM-01&to=YYYY-MM-<last day>`). Apply Singapore timezone conversions server-side.
- Each day cell shows todos due on that date; support multiple todos with count badge or stacked preview (design choice based on space).
- Overdue todos for past dates still visible when viewing previous months.
- Completed todos may appear grayed-out or under separate indicator—align with project design guidelines.
- Clicking day cell opens modal/drawer listing todos for that date with key metadata (title, priority badge, tags, reminder, completion status toggle).

### UI/UX Details
- Calendar page should match existing layout components (`app/calendar/page.tsx` using `'use client'`).
- Responsive design: On mobile, consider vertical scroll for calendar grid and modals for day detail.
- Provide empty-state messaging when no todos exist for month/day.
- Maintain consistent Tailwind classes as used elsewhere for colors, typography, spacing.
- Dark mode support: ensure background/foreground colors adapt.

### Interactivity & State
- Use React state to track `currentMonth` (e.g., `Date` object via Singapore helpers, or string `YYYY-MM`).
- On month change, refetch todos/holidays for new range.
- Memoize computed calendar matrix (array of weeks/days) for performance.
- Day modals reuse existing todo components (if practical) or lightweight representations.
- Optionally sync month navigation with URL query (`?month=YYYY-MM`) for shareable links (Next.js `useSearchParams`).

## Data & API Requirements
- Update or create API route for fetching todos by date range with authentication guard (if not already available). Respect session user ID and return due dates, completion status, priority, tags.
- Ensure date filtering uses Singapore timezone to avoid off-by-one issues around midnight.
- Holidays API returns `date`, `name` for requested range.
- Frontend should normalize data via helper functions (e.g., convert to local display strings using `formatSingaporeDate`).

## Performance Considerations
- Limit API payload to todos within requested month; include buffer days for leading/trailing week cells if needed.
- Reuse cached data when switching back to previously viewed months to reduce refetching (optional optimization).
- Avoid multiple network calls for same data; batch fetch todos and tags together if possible.

## Accessibility
- Calendar grid should be keyboard navigable (arrow keys to move days, Enter to open day modal). Use appropriate ARIA roles (`aria-label` for days, `role="grid"`).
- Holidays and todos should include descriptive text for screen readers (e.g., `aria-describedby` linking to list of todos).
- Contrast requirements met for day states (today, selected, holiday, weekend).

## Edge Cases
- Months starting on Sunday vs. other weekdays—ensure grid alignment.
- Leap years for February handling.
- Days without todos or holidays should display placeholder value.
- Handle months with daylight saving changes elsewhere gracefully (Singapore has no DST but ensure calculations don’t assume it).
- If API fails, show error state with retry.

## Out of Scope
- Weekly or daily agenda views.
- Drag-and-drop rescheduling within calendar.
- External calendar integrations (ICS sync).
- Server-side rendering for calendar data (stay client-side for now).

## QA & Testing Guidance
- Playwright tests: load calendar page, navigate prev/next, verify day count, open day modal, check todo metadata, highlight today, display holiday label.
- Unit tests for calendar generation helper (input month → matrix of weeks/days) including edge months and leap year.
- Test timezone correctness by creating todo near midnight Singapore time and verifying placement.
- Manual verification across supported browsers and in both light/dark modes.
