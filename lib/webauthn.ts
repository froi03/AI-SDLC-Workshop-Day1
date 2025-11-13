export function getRpName(): string {
  return process.env.RP_NAME ?? 'Todo App';
}

export function getRpOrigin(): string {
  return process.env.RP_ORIGIN ?? 'http://localhost:3000';
}

export function getRpId(): string {
  const explicit = process.env.RP_ID;
  if (explicit) {
    return explicit;
  }

  try {
    const origin = new URL(getRpOrigin());
    return origin.hostname;
  } catch (error) {
    console.warn('Failed to derive RP ID from RP_ORIGIN, falling back to localhost', error);
    return 'localhost';
  }
}

export function getSessionChallengeExpiryMinutes(): number {
  return 5;
}
