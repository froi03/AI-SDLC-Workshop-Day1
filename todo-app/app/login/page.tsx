'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialDescriptorJSON,
  PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

type AuthMode = 'login' | 'register';

type RegistrationOptionsPayload = {
  options: PublicKeyCredentialCreationOptionsJSON;
};

type AuthenticationOptionsPayload = {
  options: PublicKeyCredentialRequestOptionsJSON;
};

declare global {
  interface Window {
    PublicKeyCredential?: typeof PublicKeyCredential;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextUrl = useMemo(() => {
    const nextParam = searchParams.get('next');
    if (!nextParam || !nextParam.startsWith('/')) {
      return '/';
    }
    return nextParam;
  }, [searchParams]);

  const isBrowserSupported = typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

  const resetFeedback = useCallback(() => {
    setError(null);
  }, []);

  const validateForm = useCallback(() => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return null;
    }

    if (mode === 'register') {
      const trimmedDisplayName = displayName.trim();
      if (trimmedDisplayName.length === 0) {
        setError('Display name is required to register a new passkey.');
        return null;
      }
      return { email: trimmedEmail, displayName: trimmedDisplayName };
    }

    return { email: trimmedEmail };
  }, [displayName, email, mode]);

  const redirectToNext = useCallback(() => {
    router.replace(nextUrl as Route);
    router.refresh();
  }, [nextUrl, router]);

  const handleRegister = useCallback(
    async (payload: { email: string; displayName: string }) => {
      const registerOptionsResponse = await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!registerOptionsResponse.ok) {
        const data = await registerOptionsResponse.json().catch(() => ({ error: 'Failed to start registration.' }));
        throw new Error(data.error ?? 'Failed to start registration.');
      }

      const { options } = (await registerOptionsResponse.json()) as RegistrationOptionsPayload;
      const registrationOptions: PublicKeyCredentialCreationOptionsJSON = {
        ...options,
        excludeCredentials: options.excludeCredentials?.map((descriptor: PublicKeyCredentialDescriptorJSON) => ({
          ...descriptor,
          type: 'public-key' as const
        }))
      };

      const credential = await startRegistration(registrationOptions);

      const verifyResponse = await fetch('/api/auth/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: payload.email, response: credential })
      });

      if (!verifyResponse.ok) {
        const data = await verifyResponse.json().catch(() => ({ error: 'Registration verification failed.' }));
        throw new Error(data.error ?? 'Registration verification failed.');
      }
    },
    []
  );

  const handleLogin = useCallback(async (payload: { email: string }) => {
    const optionsResponse = await fetch('/api/auth/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!optionsResponse.ok) {
      const data = await optionsResponse.json().catch(() => ({ error: 'Failed to start authentication.' }));
      throw new Error(data.error ?? 'Failed to start authentication.');
    }

    const { options } = (await optionsResponse.json()) as AuthenticationOptionsPayload;
    const authenticationOptions: PublicKeyCredentialRequestOptionsJSON = {
      ...options,
      allowCredentials: options.allowCredentials?.map((descriptor: PublicKeyCredentialDescriptorJSON) => ({
        ...descriptor,
        type: 'public-key' as const
      }))
    };

    const assertion = await startAuthentication(authenticationOptions);

    const verifyResponse = await fetch('/api/auth/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: payload.email, response: assertion })
    });

    if (!verifyResponse.ok) {
      const data = await verifyResponse.json().catch(() => ({ error: 'Authentication verification failed.' }));
      throw new Error(data.error ?? 'Authentication verification failed.');
    }
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      resetFeedback();

      if (!isBrowserSupported) {
        setError('This browser does not support WebAuthn. Please try a different browser.');
        return;
      }

      const payload = validateForm();
      if (!payload) {
        return;
      }

      setIsSubmitting(true);
      try {
        if (mode === 'register') {
          await handleRegister(payload as { email: string; displayName: string });
        } else {
          await handleLogin(payload as { email: string });
        }
        redirectToNext();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [handleLogin, handleRegister, isBrowserSupported, mode, redirectToNext, resetFeedback, validateForm]
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-slate-100">{mode === 'register' ? 'Create your passkey' : 'Sign in with your passkey'}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {mode === 'register'
            ? 'Secure your todos with a passkey stored on this device. No passwords required.'
            : 'Use your registered passkey to access your todos securely.'}
        </p>

        {!isBrowserSupported && (
          <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Your browser does not support WebAuthn. Try using the latest version of Chrome, Edge, Firefox, or Safari.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="block text-sm font-semibold uppercase tracking-wide text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onFocus={resetFeedback}
              required
              className="mt-2 w-full rounded border border-slate-800 bg-slate-900 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label htmlFor="displayName" className="block text-sm font-semibold uppercase tracking-wide text-slate-300">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                onFocus={resetFeedback}
                required
                className="mt-2 w-full rounded border border-slate-800 bg-slate-900 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !isBrowserSupported}
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-slate-50 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Please wait…' : mode === 'register' ? 'Register passkey' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
          <button
            type="button"
            onClick={() => {
              resetFeedback();
              setMode((current) => (current === 'login' ? 'register' : 'login'));
            }}
            className="text-blue-300 hover:text-blue-200"
          >
            {mode === 'login' ? 'New here? Create a passkey' : 'Already registered? Sign in'}
          </button>
          <Link href="/" className="text-blue-300 hover:text-blue-200">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
