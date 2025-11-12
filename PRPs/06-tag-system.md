# PRP 06 · Tag System

## Feature Overview
The Tag System enables users to organize todos with reusable, color-coded labels. Tags are user-specific, support many-to-many relationships with todos, and power filtering within the main todo list. Users must be able to create, edit, delete, and assign tags, with the UI reflecting associations in real time and preserving accessibility standards.

## User Stories
- **Organized User**: "As someone managing many todos, I want to color-code tasks so I can visually group related work." 
- **Team Lead**: "As a lead, I need to rename or recolor tags and have all associated todos update instantly so my team sees consistent labels." 
- **Focused Planner**: "As a planner, I want to filter my todo list by specific tags so I can focus on one project at a time."

## User Flow
1. User opens the Manage Tags modal from the main todo page.
2. User creates a new tag by providing a name and selecting a color.
3. Tags appear in the modal list; users can edit or delete existing tags.
4. When editing a todo, the tag picker shows checkboxes for available tags; selecting tags attaches them to the todo.
5. Assigned tags display as colored badges on the todo card in the list view.
6. Clicking a tag badge filters the todo list to show only todos associated with that tag; a filter indicator makes the active filter clear.
7. Users clear filters via the indicator or dedicated button to return to the full list.

## Technical Requirements
- **Database Schema**
  - `tags` table: `id` (PK), `user_id` (FK → users.id ON DELETE CASCADE), `name` (TEXT, unique per user, case-insensitive), `color` (TEXT hex string), `created_at`, `updated_at` (ISO strings via Singapore timezone), optional `description` (TEXT, default null).
  - `todo_tags` join table: `todo_id` (FK → todos.id ON DELETE CASCADE), `tag_id` (FK → tags.id ON DELETE CASCADE), with composite PK `(todo_id, tag_id)`.
  - Create indexes: `CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);` and `CREATE INDEX IF NOT EXISTS idx_todo_tags_tag ON todo_tags(tag_id);`.
  - Ensure `PRAGMA foreign_keys = ON;` remains enforced in `lib/db.ts`.
- **Type Definitions**
  - Extend `lib/db.ts`: `interface Tag { id: number; userId: number; name: string; color: string; description: string | null; createdAt: string; updatedAt: string; }`
  - Helper `type TagWithCounts = Tag & { todoCount: number; };` for dashboard usage.
  - Update `Todo` type to include `tags: Tag[]` where appropriate.
- **Database Operations (synchronous)**
  - `tagDB.list(userId: number): Tag[]` sorted alphabetically by name.
  - `tagDB.create(userId: number, input: { name: string; color: string; description?: string | null; }): Tag`
  - `tagDB.update(id: number, userId: number, input: { name?: string; color?: string; description?: string | null; }): Tag`
  - `tagDB.delete(id: number, userId: number): void`
  - `tagDB.attachTag(todoId: number, tagId: number, userId: number): void`
  - `tagDB.detachTag(todoId: number, tagId: number, userId: number): void`
  - `tagDB.listByTodo(todoId: number, userId: number): Tag[]`
  - All methods validate ownership by joining to `todos` and `tags` tables where necessary.
- **API Routes**
  - `GET /api/tags` → returns `{ tags: Tag[] }` for the authenticated user.
  - `POST /api/tags` → creates tag; expects `{ name, color, description? }`; returns `{ tag }`.
  - `PUT /api/tags/[id]` → updates tag fields; returns `{ tag }`.
  - `DELETE /api/tags/[id]` → removes tag and associations; return `{ success: true }`.
  - `POST /api/todos/[id]/tags` → body `{ tagId }`; attaches tag to todo, returns `{ tags, todoId }`.
  - `DELETE /api/todos/[id]/tags` → body `{ tagId }`; detaches tag, returns `{ tags, todoId }`.
  - All handlers call `await getSession()` and verify `session.userId` owns the resource; unauthorized access yields 401/403 with JSON errors.
- **Validation Rules**
  - Tag name: trimmed, required, max 50 characters, unique per user (case-insensitive). If duplicate, respond 409 `{ error: 'Tag name already exists' }`.
  - Color: 7-character hex string `#RRGGBB`; validate via regex `^#[0-9A-Fa-f]{6}$`.
  - Description: optional, trimmed, max 200 characters.
  - On attach/detach, ensure both todo and tag belong to user; otherwise return 404.
- **Timezone Handling**
  - Use `const now = getSingaporeNow(); const iso = now.toISOString();` for `created_at`/`updated_at` fields.
- **Filtering Logic**
  - Tag filters apply an AND filter with existing priority/search filters as per project conventions.
  - Maintain selected tag state in `app/page.tsx`; when a tag is clicked again, toggle off the filter.
  - Show filter indicator (e.g., "Filtering by: Marketing" with clear button).

## UI Components & UX
- **Manage Tags Modal**
  - Trigger button near filter controls.
  - List existing tags with inline color swatches, edit (pencil) and delete (trash) actions.
  - Form fields: name input, color picker (use existing Tailwind classes for consistency), optional description textarea.
  - Disable save button while request pending; show inline validation errors.
- **Tag Picker in Todo Form**
  - Checkbox list with tag name and color dot.
  - Support multi-select; show "No tags yet" placeholder linking to Manage Tags.
  - Optimistic updates, rollback on error.
- **Tag Badges on Todo Cards**
  - Rounded pill with background color matching tag color (with contrast-aware text color). Consider using `text-white` if brightness below threshold.
  - Click handler sets filter state; `aria-pressed` attribute indicates active filter.
- **Filter Indicator**
  - Small pill/button showing active tag name; includes `×` button to clear filter.
- **Accessibility**
  - Modal focus trap, `aria-labelledby` referencing modal title.
  - Keyboard navigation for tag list and buttons.
  - Visible focus outlines matching current design system.

## Edge Cases & Constraints
- Prevent deletion of tags currently assigned? Allowed but detaches automatically (desired behavior). Confirm user action with secondary confirmation modal if tag is attached to ≥1 todo.
- When editing a tag name/color, update cache/state for all todos showing the badge without full reload.
- Ensure multiple tabs stay consistent: after tag mutation, refetch or use SWR mutate pattern to sync data.
- Handle large numbers of tags (>100) efficiently: paginate API or virtualize list if necessary; minimally, ensure queries use indexes.
- For hex colors with low contrast, automatically adjust text color to maintain WCAG AA (e.g., using a luminance helper). Provide fallback if user enters invalid color.
- When user duplicates a tag via import or manual creation, dedupe by name per user.

## Acceptance Criteria
- Users can create, edit, and delete tags with validations enforced.
- Tag assignments persist and display on todos immediately after changes.
- Filtering by tag updates the todo list and can be cleared easily.
- Tag badges reflect updated names and colors globally.
- Deleting a tag removes associations without leaving orphaned join rows.
- API endpoints enforce ownership and return descriptive errors for invalid input.
- UI remains keyboard accessible and meets contrast guidelines.

## Testing Requirements
- **Unit Tests**
  - Tag creation: unique constraint, color validation, trimming behavior.
  - Tag update: renaming, recoloring, description changes, timestamp updates.
  - Attach/detach logic: reject cross-user operations, handle duplicates gracefully.
  - Filter helpers: ensure AND logic with priority/search.
- **Playwright E2E**
  - Create tag from modal and assign to todo; verify badge appears.
  - Edit tag name/color; confirm todo badges update without reload.
  - Delete tag; ensure badges disappear and tag removed from picker.
  - Apply tag filter via badge click; verify list shows only matching todos; clear filter.
  - Validation flows: attempt duplicate tag name, invalid color, overly long name.

## Out of Scope
- Nested tag hierarchies or tag groups.
- Tag sharing between users or across organizations.
- Automatic tag suggestions based on todo content.
- Bulk tag operations from list view (beyond single todo assignment).

## Success Metrics
- Zero known incidents of orphaned tag associations or duplicate tag names per user after release.
  - Playwright Tag System spec passes 3 consecutive CI runs.
  - User feedback survey indicates ≥85% satisfaction with tag organization features.
  - Filter interactions respond in <150ms for up to 1,000 tagged todos.

## Developer Notes
- Keep new logic within `app/page.tsx` following existing monolithic pattern; avoid creating new client subtrees unless necessary.
- Reuse existing toast/notification system for success and error messages.
- All DB interactions remain synchronous; avoid introducing async wrappers around `better-sqlite3` operations.
- Update documentation (`USER_GUIDE.md`) after implementation to reflect new tag behaviors.
