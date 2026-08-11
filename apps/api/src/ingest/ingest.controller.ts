import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { listConnectors } from '@tangible/ingest';
import { StartIngestRequestSchema } from '@tangible/types';
import { IngestService } from './ingest.service.js';

@Controller('ingest')
export class IngestController {
  constructor(private readonly service: IngestService) {}

  /** Which jurisdictions can be ingested, and from where. */
  @Get('connectors')
  connectors() {
    return listConnectors().map((c) => ({
      id: c.id,
      jurisdiction: c.jurisdiction,
      format: { delimiter: c.format.delimiter, encoding: c.format.encoding },
    }));
  }

  @Get('runs')
  runs() {
    return this.service.listRuns();
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    const run = this.service.getRun(id);
    if (!run) throw new NotFoundException(`Unknown ingest run: ${id}`);
    return run;
  }

  /** Kicks off a background ingest and returns the run to poll. */
  @Post()
  start(@Body() body: unknown) {
    return this.service.start(StartIngestRequestSchema.parse(body));
  }

  /** Loads the synthetic county — clearly labelled as such throughout the UI. */
  @Post('seed-demo')
  async seedDemo(@Body() body: { accounts?: number }) {
    const rows = await this.service.seedDemoData(body?.accounts ?? 25_000);
    return { rows, jurisdictionId: 'demo-county' };
  }
}
