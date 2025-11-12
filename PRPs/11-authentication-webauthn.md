# PRP 11 · Authentication (WebAuthn/Passkeys)

## Feature Overview
Authentication uses WebAuthn (passkeys) for secure, passwordless login. Users register authenticators (biometrics, security keys) and obtain a JWT-backed session stored in HTTP-only cookies. The auth layer protects core routes and API endpoints.

## User Stories
- **New User**: “I want to register with my device’s biometric so I don’t need a password.”
- **Returning User**: “I should log in quickly with my saved passkey.”
- **Security Officer**: “Sessions must expire after a week and be revokable via logout.”

## User Flow
1. **Registration**
   - User visits `/login` and selects “Register”.
   - Client requests options from `/api/auth/register-options` (challenge, RP info).
   - Browser WebAuthn API prompts for biometric/security key.
   - Client sends response to `/api/auth/register-verify`.
   - Server verifies attestation, stores authenticator record, creates JWT session cookie, and redirects to dashboard.
2. **Login**
   - User visits `/login`, chooses “Log In”.
   - Client fetches challenge from `/api/auth/login-options`.
   - WebAuthn assertion processed; client posts to `/api/auth/login-verify`.
   - On success, server issues JWT cookie and redirects to protected page.
3. **Session Management**
   - Middleware guards protected routes (`/`, `/calendar`) by validating cookie via `getSession()`.
   - `POST /api/auth/logout` clears session cookie.

## Technical Requirements
- **Dependencies**
  - `@simplewebauthn/server` (verify attestation/assertion).
  - `@simplewebauthn/browser` for client interactions.
  - JWT handling in `lib/auth.ts` (using `jsonwebtoken` or equivalent) with 7-day expiry.
- **Database Schema (lib/db.ts)**
  - `users` table: `id`, `email` nullable? (optional), `created_at`, `updated_at`.
  - `authenticators` table fields:
    - `id` INTEGER PK
    - `user_id` INTEGER FK → users(id) ON DELETE CASCADE
    - `credential_id` TEXT UNIQUE (base64url)
    - `public_key` TEXT
    - `counter` INTEGER DEFAULT 0 (use `counter ?? 0` in assignments)
    - `transports` TEXT (JSON string array)
    - `created_at`, `updated_at`
- **Session Handling (`lib/auth.ts`)**
  - `createSession(userId: number): Promise<void>` sets HTTP-only cookie `session_token` with JWT payload { userId, exp }.
  - `getSession(): Promise<{ userId: number } | null>` verifies JWT; fallback to demo user only in dev/testing.
  - `deleteSession()` clears cookie.
- **Environment Variables**
  - `JWT_SECRET`: required for signing tokens.
  - `RP_ID`, `RP_NAME`, `RP_ORIGIN`: Pass to WebAuthn server helpers.
- **API Routes**
  - `POST /api/auth/register-options`
  - `POST /api/auth/register-verify`
  - `POST /api/auth/login-options`
  - `POST /api/auth/login-verify`
  - `POST /api/auth/logout`
  - `GET /api/auth/me` returns current user info for client state.
  - All handlers return 400/401 with descriptive errors as needed.
- **Middleware**
  - `middleware.ts` intercepts requests to `/` and `/calendar`, checks `getSession()`. Redirects to `/login` if no session.

## Edge Cases & Constraints
- Use `counter: authenticator.counter ?? 0` when storing authenticator response to avoid undefined counters.
- Handle multiple authenticators per user (store array of credentials).
- On login, ensure credential belongs to requesting user; if not found, return 401.
- Sessions expire after 7 days; optionally refresh on activity.
- Implement rate limiting (optional) or exponential backoff on repeated failures.
- Provide fallback message if browser doesn’t support WebAuthn (rare but needed).

## Acceptance Criteria
- Users can register passkeys and immediately authenticate without password.
- Login flow verifies passkey and issues session cookie.
- Protected routes redirect unauthenticated users to `/login`.
- Logout clears session and revokes access.
- API returns informative error messages on verification failure.

## Testing Requirements
- **Playwright E2E** (with virtual authenticators)
  - Register new user using virtual authenticator; confirm dashboard access.
  - Logout and log back in using same authenticator.
  - Access protected route without session to confirm redirect.
- **Unit Tests**
  - JWT helper functions generate and validate tokens correctly.
  - WebAuthn server verification wrappers handle success and failure cases (mocked).

## Out of Scope
- Traditional username/password login.
- Multi-factor authentication beyond WebAuthn.
- Account recovery flows (future enhancement).

## Success Metrics
- 100% of authentication requests use WebAuthn (no passwords stored).
- Session verification completes within <10 ms in development environment.
- 0 authentication-related security vulnerabilities post-audit.

## Developer Notes
- Use `isoBase64URL` helpers from `@simplewebauthn/server/helpers` for encoding credential IDs.
- Keep client-side WebAuthn calls within dedicated utilities for reuse between login and registration forms.
- Document setup steps (RP ID, origins) in README and deployment guides for environments like Vercel/Railway.
