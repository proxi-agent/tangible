import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // policies.ts is listed because push reconciles row-level security too: a
  // policy the schema does not declare is one push will drop, silently.
  schema: ['./src/schema.ts', './src/policies.ts'],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Use the direct (5432) connection string for migrations, not the pooler.
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
