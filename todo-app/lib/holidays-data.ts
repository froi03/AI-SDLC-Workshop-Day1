export type HolidaySeed = {
  date: string;
  name: string;
};

const HOLIDAYS_BY_YEAR: Record<number, HolidaySeed[]> = {
  2024: [
    { date: '2024-01-01', name: "New Year's Day" },
    { date: '2024-02-10', name: 'Chinese New Year' },
    { date: '2024-02-11', name: 'Chinese New Year (Day 2)' },
    { date: '2024-03-29', name: 'Good Friday' },
    { date: '2024-04-10', name: 'Hari Raya Puasa' },
    { date: '2024-05-01', name: 'Labour Day' },
    { date: '2024-05-22', name: 'Vesak Day' },
    { date: '2024-06-17', name: 'Hari Raya Haji' },
    { date: '2024-08-09', name: 'National Day' },
    { date: '2024-10-31', name: 'Deepavali' },
    { date: '2024-12-25', name: 'Christmas Day' }
  ],
  2025: [
    { date: '2025-01-01', name: "New Year's Day" },
    { date: '2025-01-29', name: 'Chinese New Year' },
    { date: '2025-01-30', name: 'Chinese New Year (Day 2)' },
    { date: '2025-04-18', name: 'Good Friday' },
    { date: '2025-03-31', name: 'Hari Raya Puasa' },
    { date: '2025-05-01', name: 'Labour Day' },
    { date: '2025-05-12', name: 'Vesak Day' },
    { date: '2025-06-06', name: 'Hari Raya Haji' },
    { date: '2025-08-09', name: 'National Day' },
    { date: '2025-10-21', name: 'Deepavali' },
    { date: '2025-12-25', name: 'Christmas Day' }
  ],
  2026: [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-02-17', name: 'Chinese New Year' },
    { date: '2026-02-18', name: 'Chinese New Year (Day 2)' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-03-20', name: 'Hari Raya Puasa' },
    { date: '2026-05-01', name: 'Labour Day' },
    { date: '2026-05-31', name: 'Vesak Day' },
    { date: '2026-06-26', name: 'Hari Raya Haji' },
    { date: '2026-08-09', name: 'National Day' },
    { date: '2026-11-09', name: 'Deepavali' },
    { date: '2026-12-25', name: 'Christmas Day' }
  ]
};

export function getHolidaySeedsForYear(year: number): HolidaySeed[] {
  return HOLIDAYS_BY_YEAR[year] ?? [];
}
