'use client';

import { useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogout = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
  await fetch('/api/auth/logout', { method: 'POST' });
  router.replace('/login' as Route);
      router.refresh();
    } catch (error) {
      console.error('Failed to logout', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isSubmitting}
      className="rounded border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-red-500/60 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isSubmitting ? 'Logging out…' : 'Logout'}
    </button>
  );
}
