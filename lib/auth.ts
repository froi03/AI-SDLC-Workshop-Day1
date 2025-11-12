import { cookies } from 'next/headers';

interface Session {
  userId: number;
}

const FALLBACK_SESSION: Session = { userId: 1 };

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session_token');

  if (!sessionCookie) {
    return FALLBACK_SESSION;
  }

  // TODO: Once WebAuthn is implemented, decode JWT session token here.
  return FALLBACK_SESSION;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new Error('Not authenticated');
  }

  return session;
}
