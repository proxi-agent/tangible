import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthController } from './health.controller.js';
import { IngestModule } from './ingest/ingest.module.js';
import { WarehouseModule } from './warehouse/warehouse.module.js';

/**
 * The ingest server.
 *
 * The read path — jurisdictions, analytics, accounts, owners — moved into the
 * Next.js app's route handlers, which query the same warehouse through the same
 * `@tangible/analytics` package. What is left here is the half that genuinely
 * needs a machine: acquiring county archives, writing DuckDB, and reporting on
 * runs that take minutes.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Read the repo-root .env so one file configures every app in the monorepo.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    WarehouseModule,
    IngestModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
