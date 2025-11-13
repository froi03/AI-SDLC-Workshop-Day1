import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { authenticatorDB, userDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';
import { getRpId, getRpName, getSessionChallengeExpiryMinutes } from '@/lib/webauthn';

const REGISTRATION_TIMEOUT_MS = 60000;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; displayName?: unknown } | null;
  if (!body || typeof body.email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  let user = userDB.findByEmail(email);
  if (!user) {
    const displayNameInput = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayNameInput) {
      return NextResponse.json({ error: 'Display name is required for registration' }, { status: 400 });
    }

    try {
      user = userDB.create({ email, displayName: displayNameInput });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  const authenticators = authenticatorDB.listByUser(user.id);

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpId(),
    userID: Buffer.from(String(user.id)),
    userName: user.email,
    userDisplayName: user.displayName,
    attestationType: 'none',
    timeout: REGISTRATION_TIMEOUT_MS,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    },
    excludeCredentials: authenticators.map((authenticator) => ({
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
