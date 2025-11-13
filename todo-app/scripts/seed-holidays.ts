import { holidayDB } from '@/lib/db';

const HOLIDAYS: Array<{ date: string; name: string }> = [
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-01-29', name: 'Chinese New Year' },
  { date: '2025-01-30', name: 'Chinese New Year (Day 2)' },
  { date: '2025-03-31', name: 'Hari Raya Puasa' },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-05-01', name: 'Labour Day' },
  { date: '2025-05-10', name: 'Vesak Day' },
  { date: '2025-06-07', name: 'Hari Raya Haji' },
  { date: '2025-08-09', name: 'National Day' },
  { date: '2025-10-20', name: 'Deepavali' },
  { date: '2025-12-25', name: 'Christmas Day' },
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year' },
  { date: '2026-02-18', name: 'Chinese New Year (Day 2)' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-20', name: 'Vesak Day' },
  { date: '2026-06-19', name: 'Hari Raya Haji' },
  { date: '2026-08-09', name: 'National Day' },
  { date: '2026-11-09', name: 'Deepavali' },
  { date: '2026-12-25', name: 'Christmas Day' }
];

async function main() {
  try {
    holidayDB.upsertMany(HOLIDAYS);
    console.log(`Seeded ${HOLIDAYS.length} Singapore public holidays.`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed holidays:', error);
    process.exit(1);
  }
}

void main();
