import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller.js';
import { IngestHistoryService } from './ingest-history.service.js';
import { IngestService } from './ingest.service.js';

@Module({
  controllers: [IngestController],
  providers: [IngestService, IngestHistoryService],
  exports: [IngestService],
})
export class IngestModule {}
