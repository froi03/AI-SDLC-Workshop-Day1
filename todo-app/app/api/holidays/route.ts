import { NextRequest, NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { getSession } from '@/lib/auth';
import { holidayDB } from '@/lib/db';
import { getHolidaySeedsForYear } from '@/lib/holidays-data';

function buildDateRange(params: URLSearchParams): { from: string; to: string } | null {
  const monthParam = params.get('month');
  if (monthParam) {
    const month = DateTime.fromFormat(monthParam, 'yyyy-LL', { zone: 'Asia/Singapore' });
    if (!month.isValid) {
      throw new Error('Invalid month parameter');
    }
    return {
      from: month.startOf('month').toISODate() ?? month.toISODate()!,
      to: month.endOf('month').toISODate() ?? month.toISODate()!
    };
  }

  const fromParam = params.get('from');
  const toParam = params.get('to');
  if (fromParam || toParam) {
    if (!fromParam || !toParam) {
      throw new Error('Both from and to parameters are required');
    }

    const fromDate = DateTime.fromISO(fromParam, { zone: 'Asia/Singapore' });
    const toDate = DateTime.fromISO(toParam, { zone: 'Asia/Singapore' });
    if (!fromDate.isValid || !toDate.isValid) {
      throw new Error('Invalid date range provided');
    }

    return {
      from: fromDate.startOf('day').toISODate()!,
      to: toDate.endOf('day').toISODate()!
    };
  }

  return null;
}

function normalizeHolidayDate(value: string): string {
  const parsed = DateTime.fromISO(value, { zone: 'Asia/Singapore' });
  if (!parsed.isValid) {
    return value;
  }
  return parsed.toISODate() ?? value;
}

function ensureHolidaysSeeded(range: { from: string; to: string }): void {
  const fromDate = DateTime.fromISO(range.from, { zone: 'Asia/Singapore' });
  const toDate = DateTime.fromISO(range.to, { zone: 'Asia/Singapore' });
  if (!fromDate.isValid || !toDate.isValid) {
    return;
  }

  const startYear = fromDate.year;
  const endYear = toDate.year;

  for (let year = startYear; year <= endYear; year += 1) {
    const seeds = getHolidaySeedsForYear(year);
    for (const seed of seeds) {
      holidayDB.upsert(seed.date, seed.name);
    }
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let range: { from: string; to: string } | null = null;
  try {
    range = buildDateRange(request.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  if (range) {
    ensureHolidaysSeeded(range);
  } else {
    ensureHolidaysSeeded({ from: '2024-01-01', to: '2026-12-31' });
  }

  const holidays = range
    ? holidayDB.listBetween(range.from, range.to)
    : holidayDB.listAll();

  const payload = {
    holidays: holidays.map((holiday) => ({
      ...holiday,
      date: normalizeHolidayDate(holiday.date)
    }))
  };

  return NextResponse.json(payload);
}
