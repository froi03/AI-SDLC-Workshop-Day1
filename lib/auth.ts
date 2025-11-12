export interface Session {
  userId: number;
  username: string;
}

/**
 * Placeholder session resolver. The production implementation should validate
 * WebAuthn credentials and decode JWT-based sessions. For the CRUD feature we
 * return the seeded demo user so that the API routes stay focused on data
 * flows. Update this implementation when the authentication feature lands.
 */
export async function getSession(): Promise<Session | null> {
  return { userId: 1, username: 'demo' };
}
