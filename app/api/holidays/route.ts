import { NextRequest, NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { getSession } from '@/lib/auth';
import { holidayDB } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const monthParam = request.nextUrl.searchParams.get('month');

  if (!monthParam) {
    const holidays = holidayDB.listAll();
    return NextResponse.json({ holidays });
  }

  const parsedMonth = DateTime.fromFormat(monthParam, 'yyyy-LL', { zone: 'Asia/Singapore' }).startOf('month');
  if (!parsedMonth.isValid) {
    return NextResponse.json({ error: 'Invalid month parameter' }, { status: 400 });
  }

  const rangeStart = parsedMonth.toISODate();
  const rangeEnd = parsedMonth.plus({ months: 1 }).toISODate();
  if (!rangeStart || !rangeEnd) {
    return NextResponse.json({ error: 'Failed to derive month boundaries' }, { status: 400 });
  }

  const holidays = holidayDB.listByDateRange(rangeStart, rangeEnd);
  return NextResponse.json({ holidays });
}
