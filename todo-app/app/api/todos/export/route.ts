import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const payload = todoDB.exportData(session.userId);

  const now = getSingaporeNow();
  const timestamp = now.toFormat('yyyyLLdd-HHmmss');
  const filename = `todos-export-${timestamp}.json`;

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}
