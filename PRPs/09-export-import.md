# PRP 09 · Export & Import

## Feature Overview
Export and import provide data portability, allowing users to back up todos (including subtasks, tags, and relationships) and restore them later or migrate between environments. Export generates a structured JSON file; import validates and merges data without creating duplicates.

## User Stories
- **Consultant**: “I want to export my todo history before switching laptops.”
- **Team Lead**: “Import a template of recurring tasks for new team members.”
- **Power User**: “Backup my data before testing the template system.”

## User Flow
1. User clicks “Export” button.
2. Backend returns JSON payload; browser triggers file download (e.g., `todos-export-YYYYMMDD.json`).
3. User later clicks “Import” and selects a previously exported file.
4. UI uploads file to backend, showing progress and success/error messages.
5. Imported todos appear immediately in the list with relationships intact.

## Technical Requirements
- **API Endpoints**
  - `GET /api/todos/export`
    - Authenticated.
    - Returns `application/json` with structure:
      ```json
      {
        "version": "1.0",
        "generatedAt": "ISO",
        "todos": [...],
        "subtasks": [...],
        "tags": [...],
        "todoTags": [...]
      }
      ```
    - Include all fields necessary to reconstruct records, referencing original IDs.
  - `POST /api/todos/import`
    - Accepts JSON body matching export format.
    - Validates `version` compatibility.
    - Performs import inside a transaction.
    - Remaps IDs to avoid collisions; e.g., maintain mapping from old todo IDs to new inserted IDs.
    - Avoids duplicate tags: match by `name` (case-insensitive) and reuse existing tags when possible.
    - Returns summary `{ importedTodosCount, importedSubtasksCount, importedTagsCount }`.
- **Database Handling**
  - Use synchronous `better-sqlite3` statements with transactions for atomic imports.
  - When inserting subtasks and todo_tags, use newly assigned todo/tag IDs via mapping.
- **Validation**
  - Ensure file contains all required fields; reject invalid format with 400 and descriptive errors.
  - Enforce maximum file size (e.g., <5 MB) to prevent misuse.
  - Skip todos belonging to other users (only import for current session user).
- **UI Components**
  - Export button triggering fetch and file download using `URL.createObjectURL`.
  - Import button opening file input; show spinner/toast during upload.
  - Display success summary (e.g., “Imported 5 todos, 12 subtasks, 3 tags”).
  - Error messaging for invalid file or mismatched version.

## Edge Cases & Constraints
- Handle empty dataset exports gracefully.
- When importing, detect duplicates by title? (No—allow duplicates except tags; rely on user to manage.)
- If import fails mid-way, transaction rollback should leave database untouched.
- Ensure timezone values (due dates, completed_at) remain ISO strings referencing Singapore conversions.
- Validate reminder offsets to be in allowed set; if not, default to null.
- Prevent cross-user import (IDs always tied to session user).

## Acceptance Criteria
- Export returns JSON with todos, subtasks, tags, relationships, and metadata preserved.
- Importing previously exported file recreates all records for the user with correct relationships.
- Import operates idempotently: repeated import does not create duplicate tags.
- Invalid JSON or incompatible version yields descriptive error without partial writes.

## Testing Requirements
- **Unit Tests**
  - ID remapping utility ensuring relationships maintained.
  - Validation functions for import payload.
- **Integration Tests**
  - Import scenario verifying counts and data equivalence (create, export, drop DB, import into new DB).
- **Playwright E2E**
  - Export file and verify download presence (use Playwright file assertions).
  - Import valid file; confirm UI displays summary and todos appear.
  - Import invalid file; ensure error toast shown and data unchanged.

## Out of Scope
- Partial exports (e.g., by tag or date range).
- Automatic scheduled backups.
- Support for formats other than JSON (e.g., CSV).

## Success Metrics
- Import completes within 2 seconds for datasets up to 1,000 todos with relationships.
- 0 data integrity issues (verified via automated tests) after round-trip export/import.
- User satisfaction rating ≥ 4/5 for portability feature in feedback survey.

## Developer Notes
- Store export version in constant for forward compatibility; increment when schema changes.
- Consider streaming response for large exports to avoid blocking event loop (future enhancement).
- Document import/export format in `USER_GUIDE.md` for transparency.
