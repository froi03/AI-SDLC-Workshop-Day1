import { test, expect } from '@playwright/test';
import { authenticatorDB, db, userDB } from '@/lib/db';

const TEST_USER_ID = 1;

function restoreChallenge(original: { challenge: string | null; expiresAt: string | null }) {
  if (original.challenge && original.expiresAt) {
    userDB.setChallenge(TEST_USER_ID, original.challenge, original.expiresAt);
    return;
  }

  if (original.challenge && !original.expiresAt) {
    userDB.setChallenge(TEST_USER_ID, original.challenge, null);
    return;
  }

  if (!original.challenge && original.expiresAt) {
    userDB.setChallenge(TEST_USER_ID, 'restored-challenge', original.expiresAt);
    userDB.clearChallenge(TEST_USER_ID);
    return;
  }

  userDB.clearChallenge(TEST_USER_ID);
}

test.describe('WebAuthn persistence helpers', () => {
  let baselineChallenge: { challenge: string | null; expiresAt: string | null };
  const createdCredentials: string[] = [];

  test.beforeEach(() => {
    const user = userDB.getById(TEST_USER_ID);
    expect(user).toBeDefined();
    baselineChallenge = {
      challenge: user?.currentChallenge ?? null,
      expiresAt: user?.currentChallengeExpiresAt ?? null
    };
  });

  test.afterEach(() => {
    restoreChallenge(baselineChallenge);

    const remover = db.prepare('DELETE FROM authenticators WHERE credential_id = ?');
    for (const credentialId of createdCredentials.splice(0)) {
      remover.run(credentialId);
    }
  });

  test('user challenge helpers set and clear session challenges', () => {
    const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    userDB.setChallenge(TEST_USER_ID, 'integration-challenge', expiry);
    let user = userDB.getById(TEST_USER_ID);
    expect(user?.currentChallenge).toBe('integration-challenge');
    expect(user?.currentChallengeExpiresAt).toBe(expiry);

    userDB.clearChallenge(TEST_USER_ID);
    user = userDB.getById(TEST_USER_ID);
    expect(user?.currentChallenge).toBeNull();
    expect(user?.currentChallengeExpiresAt).toBeNull();
  });

  test('authenticator upsert normalizes transports and updateCounter persists', () => {
    const credentialId = `cred-${Date.now()}`;
    createdCredentials.push(credentialId);

    const initial = authenticatorDB.upsert({
      userId: TEST_USER_ID,
      credentialId,
      publicKey: Buffer.from('test-key').toString('base64'),
      counter: 10,
      transports: ['usb', 'usb', 'invalid'] as unknown as string[]
    });

    expect(initial.transports).toEqual(['usb']);
    expect(initial.counter).toBe(10);

    const updated = authenticatorDB.upsert({
      userId: TEST_USER_ID,
      credentialId,
      publicKey: Buffer.from('test-key-2').toString('base64'),
      counter: 7,
      transports: ['nfc', 'usb']
    });

    expect(updated.transports).toEqual(['nfc', 'usb']);
    expect(updated.counter).toBe(7);

    authenticatorDB.updateCounter(updated.id, 42);
    const fetched = authenticatorDB.findByCredentialId(TEST_USER_ID, credentialId);
    expect(fetched).toBeDefined();
    expect(fetched?.counter).toBe(42);
  });
});
