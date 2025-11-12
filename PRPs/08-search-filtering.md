# PRP 08 · Search & Filtering

## Feature Overview
Search and filtering empower users to locate specific todos quickly by text, priority, tags, and completion state. The feature operates entirely client-side using data fetched from existing APIs while respecting Singapore timezone context for date-based filters.

## User Stories
- **Project Manager**: “I need to search todos by keyword to locate related tasks fast.”
- **Designer**: “Filter tasks by tag to focus on UX backlog items.”
- **Ops Analyst**: “Combine priority and tag filters to view urgent support tickets only.”

## User Flow
1. User types into the search input at the top of the dashboard.
2. The list updates in real-time with debounced matching.
3. User refines results by selecting priority and/or tag filters.
4. Active filters display above the todo lists with clear buttons.
5. When no todos match, show an informative empty state message.

## Technical Requirements
- **Client State**
  - Maintain `searchQuery`, `selectedPriority`, and `selectedTags` in component state (`app/page.tsx`).
  - Debounce search input (≈300 ms) to avoid excessive re-renders.
- **Filtering Logic**
  - Search is case-insensitive and trims whitespace.
  - Matches against todo title and description; optionally tag names if already loaded.
  - Priority filter single-select (All, High, Medium, Low).
  - Tag filter multi-select (AND logic across selected tags).
  - Combine conditions using AND: todo must satisfy every active filter/search.
  - Completed/Overdue grouping should process filtered subset while preserving original sorting logic.
- **UI Components**
  - Search bar with placeholder “Search todos…”.
  - Priority dropdown or segmented control.
  - Tag filter chips/pills; clicking toggles selection.
  - Filter summary bar showing active filters with remove buttons.
  - Clear-all control to reset search and filters.
  - Empty state card with suggestion to adjust filters.
- **Timezone**
  - If implementing date range filters (optional), use Singapore timezone conversions.

## Edge Cases & Constraints
- Debounce search to avoid lag on large datasets (≥500 todos).
- When new todos fetched or created, re-run current filters automatically.
- If selected tag deleted, remove it from filter state gracefully.
- Keep search input accessible (label, `aria-label`).
- Do not call backend for every keystroke; operate on client view model.

## Acceptance Criteria
- Search text updates filtered view in real-time and is case-insensitive.
- Priority and tag filters apply simultaneously with AND logic.
- Combined filters produce expected subset; clearing resets to full list.
- Empty results display friendly message; UI doesn’t break.
- Sorting within each section (Overdue, Active, Completed) honors filtered data.

## Testing Requirements
- **Unit Tests**
  - Filtering utility function covering combinations of query/priority/tags.
  - Debounce hook (if custom) to ensure timing behavior.
- **Playwright E2E**
  - Search by keyword; confirm expected todos visible.
  - Apply priority filter; ensure only matching priority shown.
  - Toggle multiple tags; verify AND logic (only todos containing all selected tags remain).
  - Clear filters to restore full list.
  - Validate empty state message appears when no matches.

## Out of Scope
- Server-side search API endpoints (client-only for now).
- Advanced query syntax (e.g., `tag:Work priority:high`).
- Fuzzy matching beyond basic substring search.

## Success Metrics
- Filter operations complete within 100 ms on dataset of 1,000 todos.
- User satisfaction in usability test: 90% find tasks quicker with filters enabled.
- No regressions in grouping or sorting when filters active.

## Developer Notes
- Extract filtering logic into a pure function (`filterTodos`) to reuse in tests and component.
- Consider memoization (`useMemo`) to avoid unnecessary computations.
- Update `USER_GUIDE.md` with instructions on combined filters.
