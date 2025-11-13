import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { userDB } from '@/lib/db';

export interface Session {
  userId: number;
}

export const SESSION_COOKIE_NAME = 'session_token';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }
  return secret;
}

type SessionPayload = jwt.JwtPayload & {
  userId: number;
};

export function verifySessionToken(token: string | undefined | null): Session | null {
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as SessionPayload;
    if (!decoded || typeof decoded.userId !== 'number') {
      return null;
    }

    const user = userDB.getById(decoded.userId);
    if (!user) {
      return null;
    }

    return { userId: user.id };
  } catch (error) {
    console.error('Failed to verify session token', error);
    return null;
  }
}

export function applySessionCookie(response: NextResponse, userId: number): void {
  const token = jwt.sign({ userId }, getJwtSecret(), { expiresIn: SESSION_TTL_SECONDS });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/'
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  });
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(sessionCookie);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new Error('Not authenticated');
  }
  return session;
}
