import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userDB } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  const user = userDB.getById(session.userId);
  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName
    }
  });
}
