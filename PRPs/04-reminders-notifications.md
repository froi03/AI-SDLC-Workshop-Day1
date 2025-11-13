# PRP 04 · Reminders & Notifications

## Feature Overview
Reminders allow users to receive browser notifications ahead of a todo’s due date. The system coordinates backend polling, reminder timing calculations in Singapore timezone, and a client hook that requests notification permission and displays badge states.

## User Stories
- **Remote Worker**: “I need an alert 30 minutes before meetings so I can prepare in time.”
- **Student**: “I want homework reminders the day before they’re due.”
- **Manager**: “Send a notification two hours ahead of a review so I can gather notes.”

## User Flow
1. User clicks “Enable Notifications” button; browser permission prompt appears.
2. Upon approval, the UI reflects enabled status.
3. While creating or editing a todo with a due date, user chooses a reminder offset (15m, 30m, 1h, 2h, 1d, 2d, 1w).
4. Backend job (triggered via `GET /api/notifications/check`) identifies todos whose reminder window has arrived.
5. Client polls the endpoint (every 30 seconds). When matches returned, it displays notifications using the Notifications API and updates `last_notification_sent` to prevent duplicates.

## Technical Requirements
- **Database**
  - `todos` table includes `reminder_minutes` (nullable) storing offset in minutes.
  - Add `last_notification_sent` column (TEXT ISO string) to record last sent timestamp; default `NULL`.
- **Timezone**
  - Use `getSingaporeNow()` for current time calculations.
  - Convert due dates to Singapore zone before subtracting reminder offset.
- **API Routes**
  - `PUT /api/todos/[id]`: validation ensures reminder only set when due date exists.
  - `GET /api/notifications/check`
    - Authenticated endpoint.
    - Returns todos for the user where:
      - `reminder_minutes` not null.
      - `due_date` not null.
      - `last_notification_sent` null OR more than reminder window behind.
      - Current Singapore time >= due date minus reminder offset.
      - Current time < due date to avoid overdue spam.
    - On match, update `last_notification_sent` to current UTC ISO.
- **Client Hook** (`lib/hooks/useNotifications.ts`)
  - Manages notification permission state.
  - Exposes `enableNotifications()` request function and boolean flag.
  - Polls endpoint on interval (e.g., `useEffect` with `setInterval` 30s) when permission granted.
  - Uses `new Notification(title, options)` for each returned todo; include todo title, due date snippet.
- **Badge UI**
  - Todos show `Reminder XX` badge (e.g., `Reminder 30m`).
  - Disabled state when due date absent or no reminder set.

## Edge Cases & Constraints
- Reminder must be one of the accepted offsets; reject arbitrary numbers.
- When due date removed, automatically nullify reminder.
- Browser notifications require document visibility; handle permission denied gracefully (show toast or inline message).
- Prevent duplicates: once `last_notification_sent` set, skip until due date or reminder changes.
- If user re-enables reminder with same offset, reset `last_notification_sent` to null.
- If due date is updated, ensure reminder recalculates relative to new due date.

## Acceptance Criteria
- Users can enable/disable reminders during create/edit flows when due date present.
- Browser prompts for permission and reflects status in UI.
- Notifications fire at correct offset based on Singapore timezone calculations.
- Duplicate notifications are not sent for the same reminder.
- API endpoint respects authentication and only returns relevant todos for that user.

## Testing Requirements
- **Unit Tests**
  - Reminder calculation helper: given due date and offset, confirm trigger times.
  - Query builder for `notifications/check` to ensure conditions correct.
- **Playwright E2E**
  - Enable notifications UI flow (maybe mock Notification permission handled via test browser flags).
  - Set reminder and fast-forward time (or stub) to validate endpoint returns expected todo.
  - Ensure badge updates when reminder set/removed.
- **Manual Testing**
  - Confirm notifications appear in supported browsers (Chrome/Edge) with Singapore timezone.

## Out of Scope
- Email, SMS, or push notifications beyond browser Notification API.
- Multiple reminder offsets per todo.
- Snooze or mark-as-done from notification.

## Success Metrics
- Reminder notifications triggered within ±1 minute of target time.
- No duplicate notifications observed in QA environment across 24h runs.
- Notification enablement success rate > 90% (users granting permission vs. requests).

## Developer Notes
- Polling interval should balance responsiveness vs. network usage (30s recommended, configurable).
- When running Playwright, use `--disable-features=PermissionPromptBubbleView` or equivalent to auto-approve notifications for tests.
- Document browser limitations (e.g., Safari requires user gesture to enable notifications) in `USER_GUIDE.md`.
