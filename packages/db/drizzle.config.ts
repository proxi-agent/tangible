import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Use the direct (5432) connection string for migrations, not the pooler.
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
