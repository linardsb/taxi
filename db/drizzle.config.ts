import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi',
  },
  // Without this drizzle-kit tries to manage postgis's own spatial_ref_sys table.
  extensionsFilters: ['postgis'],
});
