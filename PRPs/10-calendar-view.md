# PRP 10 · Calendar View

## Feature Overview
The calendar view presents todos on a monthly grid, highlighting due dates, weekends, and Singapore public holidays. Users can navigate months, inspect day details, and visualize workload distribution alongside holiday data.

## User Stories
- **Project Planner**: “I want to see all upcoming deadlines for the month on a calendar.”
- **Vacation Planner**: “Show public holidays so I can schedule tasks around them.”
- **Team Lead**: “Click a date to view todos due that day and reassign work if needed.”

## User Flow
1. Authenticated user navigates to `/calendar` (protected route).
2. Calendar loads current month by default (Singapore timezone) with navigation controls for previous/next/today.
3. Each day cell displays due todos count and holiday labels where applicable.
4. Clicking a day opens a modal listing todos for that date with quick actions (view/edit).
5. URL query `?month=YYYY-MM` updates as user navigates, allowing shareable links.

## Technical Requirements
- **Database**
  - `holidays` table with fields: `id`, `date` (ISO string), `name`, `created_at`, `updated_at`.
  - Ensure data seeded via `scripts/seed-holidays.ts` using Singapore public holidays.
- **API Routes**
  - `GET /api/holidays`
    - Returns holidays for authenticated user (shared dataset but still require auth).
  - `GET /api/todos?month=YYYY-MM` optional optimization to fetch monthly subset; otherwise fetch all and filter client-side (trade-off: for large datasets, consider month parameter).
- **Calendar Component** (`app/calendar/page.tsx`)
  - Client component managing state: current month `DateTime` (luxon) in Singapore timezone.
  - Generate week rows using startOf('month').startOf('week') pattern (Sunday–Saturday) or Monday start depending on design.
  - Highlight today with special styling.
  - Distinguish weekends (Saturday/Sunday) with muted colors.
  - Display holiday badge with holiday name (truncate if long; tooltip for full name).
  - Each day cell shows todo count; clicking opens detail modal.
- **Detail Modal**
  - Lists todos due that day with priority badges and quick links to open in main page (`/` with query?).
  - Optionally allow marking complete via fetch call.
- **Timezone**
  - Use `DateTime` in `Asia/Singapore` for all calculations; day boundaries rely on local midnight.

## UI & UX Guidelines
- Navigation controls: `◀ Previous`, `Today`, `Next ▶`.
- Month title displayed as `November 2025` (Singapore locale).
- Day cells responsive with CSS grid (7 columns, up to 6 rows).
- Use Tailwind for styling dark theme consistent with main dashboard.
- Provide legend for holidays and weekend color coding.

## Edge Cases & Constraints
- Handle months starting mid-week; show blank cells (muted) for previous/next month days.
- Large number of todos on a day: show count badge; clicking reveals scrollable list.
- If user has no todos, calendar still displays holidays.
- Ensure accessibility: each day cell should be focusable; modal accessible (aria attributes).
- Keep URL query synced without causing full page reload (use `useRouter().replace`).

## Acceptance Criteria
- Calendar loads with current month and shows todos on their due dates.
- Navigation buttons update view and URL query parameter.
- Public holidays display with correct names and dates.
- Clicking a day opens modal listing todos due that day.
- Weekend and today styling distinct and accessible.

## Testing Requirements
- **Unit Tests**
  - Calendar generation utility (given month, returns correct grid of days including leading/trailing days).
  - Functions mapping todos to date buckets.
- **Playwright E2E**
  - Navigate to `/calendar`; ensure data loads and matches API.
  - Step through previous/next/today controls; verify URL updates.
  - Click a day with todos; confirm modal shows correct list.
  - Validate holiday badge presence on known holiday (use seeded data).

## Out of Scope
- Drag-and-drop rescheduling within calendar (future enhancement).
- Week or agenda views (only monthly grid).
- Printing/exporting calendar view.

## Success Metrics
- Calendar renders within 200 ms on navigation.
- Accurate holiday display validated against `holidays` table.
- User feedback indicates improved visibility into due dates (survey rating ≥ 4/5).

## Developer Notes
- Prefer extracting calendar generation into `lib/calendar.ts` for reuse/testing.
- Cache holidays client-side since dataset is static per year.
- Document `/calendar` usage and navigation in `USER_GUIDE.md`.
