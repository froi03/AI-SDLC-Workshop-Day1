import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/types';
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
    return NextResponse.json({ error: 'No authentication challenge in progress' }, { status: 400 });
  }

  if (user.currentChallengeExpiresAt) {
    const expiry = DateTime.fromISO(user.currentChallengeExpiresAt);
    if (!expiry.isValid || expiry < getSingaporeNow().toUTC()) {
      userDB.clearChallenge(user.id);
      return NextResponse.json({ error: 'Authentication challenge expired' }, { status: 400 });
    }
  }

  const authenticationResponse = body.response as AuthenticationResponseJSON;
  const credentialId = authenticationResponse.rawId;
  if (!credentialId) {
    return NextResponse.json({ error: 'Missing credential ID' }, { status: 400 });
  }

  const authenticator = authenticatorDB.findByCredentialId(user.id, credentialId);
  if (!authenticator) {
    return NextResponse.json({ error: 'Authenticator not found' }, { status: 404 });
  }

  const transports = authenticator.transports.filter((value): value is AuthenticatorTransportFuture =>
    value === 'ble' ||
    value === 'cable' ||
    value === 'hybrid' ||
    value === 'internal' ||
    value === 'nfc' ||
    value === 'smart-card' ||
    value === 'usb'
  );

  try {
    const verification = await verifyAuthenticationResponse({
      response: authenticationResponse,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
      authenticator: {
        credentialID: authenticator.credentialId,
        credentialPublicKey: Buffer.from(authenticator.publicKey, 'base64'),
        counter: authenticator.counter ?? 0,
        transports: transports.length > 0 ? transports : undefined
      },
      requireUserVerification: true
    });

    if (!verification.verified) {
      return NextResponse.json({ error: 'Authentication verification failed' }, { status: 401 });
    }

    authenticatorDB.updateCounter(authenticator.id, verification.authenticationInfo.newCounter ?? authenticator.counter ?? 0);
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
    console.error('Failed to verify authentication response', error);
    return NextResponse.json({ error: 'Failed to verify authentication response' }, { status: 400 });
  }
}
