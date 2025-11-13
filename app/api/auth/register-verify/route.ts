import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';
import { authenticatorDB, userDB } from '@/lib/db';
import { getRpId, getRpOrigin } from '@/lib/webauthn';
import { getSingaporeNow } from '@/lib/timezone';
import { DateTime } from 'luxon';
import { applySessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; response?: unknown } | null;
  if (!body || typeof body.email !== 'string' || typeof body.response !== 'object' || body.response === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const user = userDB.findByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (!user.currentChallenge) {
    return NextResponse.json({ error: 'No registration challenge in progress' }, { status: 400 });
  }

  if (user.currentChallengeExpiresAt) {
    const expiry = DateTime.fromISO(user.currentChallengeExpiresAt);
    if (!expiry.isValid || expiry < getSingaporeNow().toUTC()) {
      userDB.clearChallenge(user.id);
      return NextResponse.json({ error: 'Registration challenge expired' }, { status: 400 });
    }
  }

  const registrationResponse = body.response as RegistrationResponseJSON;

  let transports: string[] = [];
  if (
    registrationResponse.response &&
    Array.isArray((registrationResponse.response as { transports?: unknown }).transports)
  ) {
    transports = ((registrationResponse.response as { transports?: unknown }).transports as unknown[]).filter(
      (value): value is string => typeof value === 'string'
    );
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
      requireUserVerification: true
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Registration verification failed' }, { status: 400 });
    }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  const credentialId = credentialID;
    const publicKey = Buffer.from(credentialPublicKey).toString('base64');

    authenticatorDB.upsert({
      userId: user.id,
      credentialId,
      publicKey,
      counter: counter ?? 0,
      transports
    });

    userDB.clearChallenge(user.id);

    const responsePayload = NextResponse.json({
      verified: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      }
    });

    applySessionCookie(responsePayload, user.id);
    return responsePayload;
  } catch (error) {
    console.error('Failed to verify registration response', error);
    return NextResponse.json({ error: 'Failed to verify registration response' }, { status: 400 });
  }
}
