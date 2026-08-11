import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateEnv, type Env } from '../config/env.js';

/**
 * Load the repo-root .env for CLI scripts, which run outside Nest's ConfigModule.
 * Node's built-in --env-file is not used so the scripts stay runnable via `tsx`
 * without extra flags.
 */
export function loadEnv(): Env {
  for (const candidate of ['.env', '../../.env', resolve(process.cwd(), '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
  }
  return validateEnv(process.env as Record<string, unknown>);
}
