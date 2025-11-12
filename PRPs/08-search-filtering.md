# Feature 08 – Search & Advanced Filtering (PRP)

## Objective
- Allow users to quickly locate todos and subtasks by keyword, priority, tag, completion status, and due date range within a single, responsive interface.
- Provide saved filter presets so frequently used combinations can be recalled with one click.

## Background & Context
- Core todo list lives on `app/page.tsx` as a client component; new logic must integrate with existing monolithic state management and fetch patterns.
- All time-based calculations must respect the Singapore timezone helper functions in `lib/timezone.ts` (do not use `new Date()` directly).
- Existing datasets include todos, subtasks, tags, and saved filter configuration (currently stored in localStorage per the README and USER_GUIDE).

## User Stories
- "As a busy professional, I want to type a keyword and instantly see matching todos or subtasks so I can triage work without scrolling." 
- "As someone managing many tagged tasks, I want to filter by a specific tag and priority to focus on the most urgent work." 
- "As a planner, I want to save a filter configuration (e.g., 'This Week – High Priority') so I can reuse it every Monday without reselecting options." 
- "As a user reviewing past work, I need to filter completed todos within a date range to track historical progress."

## Functional Requirements

### Search Bar
- Full-width text input located beneath the todo creation form; placeholder: `"Search todos and subtasks..."`.
- Debounced input (≈300 ms) for performance.
- Case-insensitive substring match against todo titles and subtask titles.
- Clearing the text (or clicking an attached ✕ icon) resets the search filter.

### Quick Filters Row
- Dropdown: `Priority` with options `All`, `High`, `Medium`, `Low`; defaults to `All`.
- Dropdown: `Tag` with options `All Tags` plus user-owned tags; hidden if user has no tags.
- Toggle button for Advanced Filters (`▶ Advanced` when collapsed, `▼ Advanced` when expanded); indicates active state via background color change.
- When any filter is active, display `Clear All` (danger style) and `Save Filter` (success style) buttons.

### Advanced Filters Panel
- Completion status dropdown: `All Todos`, `Incomplete Only`, `Completed Only`.
- Due date range inputs (two date pickers): From and To; accept empty values; inclusive range; respects Singapore timezone conversions.
- Saved filter preset chips listed when available (show name and delete control). Clicking a chip applies the stored configuration.

### Saved Filter Presets
- `Save Filter` opens modal summarizing current selections and provides text input for preset name (required, trimmed, unique per user in localStorage scope).
- Presets stored in browser localStorage (key should include authenticated user ID to avoid cross-user leakage on shared device).
- Applying a preset overwrites current filters; UI reflects applied values immediately.
- Deleting a preset removes it from localStorage and updates UI without page reload.

### Filter Logic
- Filters combine using logical AND; only todos matching **all** active criteria appear.
- Search applies to both todos and subtasks; subtask match should surface parent todo even if title does not match.
- Tag, priority, completion, and date filters operate only on todos (not subtasks independently).
- Date filters should ignore todos without due dates unless range is empty.
- Overdue, Pending, and Completed sections automatically recalc counts after filters applied; hide sections with zero results.

### UI/UX Details
- Maintain existing Tailwind-based styling conventions; ensure responsive layout (desktop, tablet, mobile).
- Provide empty state messaging when no results match filters.
- When filters active, consider subtle badge or text summary showing current criteria.
- Ensure dark mode compatibility (existing design tokens).

### Accessibility & Localization
- Inputs must be keyboard navigable (tab order, ARIA labels where necessary).
- Ensure contrast ratios meet WCAG AA in both themes.
- Support screen readers by labeling filter controls and summaries.

## Data & API Requirements
- No new server API needed; filtering occurs client-side using current todo state fetched from API.
- Any new helper functions should live alongside existing client utilities in `app/page.tsx` or extracted into adjacent module if justified.
- Date comparisons should rely on utilities from `lib/timezone.ts` to normalize values to `Asia/Singapore`.

## State Management
- Extend existing state hooks (likely `useState` / `useMemo`) in `app/page.tsx` to track search string, selected priority, tag, completion state, date range, and saved presets.
- Memoize filtered list to avoid unnecessary rerenders; include dependencies for all filter inputs and source data.
- Persist presets to localStorage on save, retrieve on initialization (ensure hydration guards to avoid SSR mismatches).

## Performance Constraints
- Filtering should remain <100 ms for up to 1,000 todos (per Evaluation checklist); use memoization and efficient string comparisons.
- Debounce search input to reduce state churn.
- Avoid triggering additional network requests when manipulating filters.

## Edge Cases
- Empty search + default filters returns full list.
- Partial filters (e.g., only From date) should behave intuitively: From applies lower bound, To applies upper bound.
- Subtask match should show todo even if parent is completed or overdue (respect completion filter afterwards).
- LocalStorage unavailability (private mode) must fail gracefully—disable presets with user message.
- Handle malformed preset data (e.g., corrupted JSON) by clearing invalid entries.

## Out of Scope
- Server-side search or API pagination.
- Cross-user sharing of saved presets.
- Exporting filters as sharable links.
- Fuzzy search or advanced query syntax beyond simple substring match.

## QA & Testing Guidance
- Update or add Playwright E2E tests covering: basic search, combined filters, date range, presets lifecycle, and empty states.
- Add unit tests (if applicable) for filtering helper functions, ensuring timezone correctness.
- Verify in browsers listed in project docs (Chromium, Firefox, Safari) and both light/dark modes.
