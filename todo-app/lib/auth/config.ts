const FALLBACK_DEV_SECRET = 'todo-app-development-secret';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    console.warn('JWT_SECRET is not set; using fallback development secret.');
    return FALLBACK_DEV_SECRET;
  }

  throw new Error('JWT_SECRET environment variable is not configured');
}
