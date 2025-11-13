import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  snapshotDir: './tests/__snapshots__',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    timezoneId: 'Asia/Singapore'
  },
  reporter: [['list']]
});
