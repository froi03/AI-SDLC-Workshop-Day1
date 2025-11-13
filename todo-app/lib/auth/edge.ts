import { jwtVerify } from 'jose';
import { getJwtSecret } from './config';
import type { Session } from './types';

const encoder = new TextEncoder();
let cachedSecret: Uint8Array | null | undefined;

function getSecretKey(): Uint8Array | null {
  if (cachedSecret !== undefined) {
    return cachedSecret;
  }

  try {
    cachedSecret = encoder.encode(getJwtSecret());
    return cachedSecret;
  } catch (error) {
    console.error('JWT secret is not configured', error);
    cachedSecret = null;
    return null;
  }
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) {
    return null;
  }

  const secretKey = getSecretKey();
  if (!secretKey) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
    if (!payload || typeof payload.userId !== 'number') {
      return null;
    }

    return { userId: payload.userId };
  } catch (error) {
    console.error('Failed to verify session token (edge)', error);
    return null;
  }
}
