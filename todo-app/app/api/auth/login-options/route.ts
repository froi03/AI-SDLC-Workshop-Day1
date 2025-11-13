import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticatorDB, userDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';
import { getRpId, getSessionChallengeExpiryMinutes } from '@/lib/webauthn';

const AUTHENTICATION_TIMEOUT_MS = 60000;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  if (!body || typeof body.email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const user = userDB.findByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const authenticators = authenticatorDB.listByUser(user.id);
  if (authenticators.length === 0) {
    return NextResponse.json({ error: 'No authenticators registered for this user' }, { status: 400 });
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    timeout: AUTHENTICATION_TIMEOUT_MS,
    userVerification: 'preferred',
    allowCredentials: authenticators.map((authenticator) => ({
      id: authenticator.credentialId,
      type: 'public-key' as const
    }))
  });

  const expiresAt = getSingaporeNow().plus({ minutes: getSessionChallengeExpiryMinutes() }).toUTC().toISO();
  if (!expiresAt) {
    return NextResponse.json({ error: 'Failed to compute challenge expiry' }, { status: 500 });
  }

  userDB.setChallenge(user.id, options.challenge, expiresAt);

  return NextResponse.json({
    options,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName
    }
  });
}
