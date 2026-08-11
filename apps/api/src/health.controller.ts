import { Controller, Get } from '@nestjs/common';
import { WarehouseService } from './warehouse/warehouse.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly warehouseService: WarehouseService) {}

  /**
   * Deliberately does not query the warehouse.
   *
   * This process only opens the file while it is writing to it, and a health
   * check that opened it would take the write lock away from the dashboard for
   * no reason. What is worth reporting here is that the server is up and
   * whether an ingest currently holds the file.
   */
  @Get()
  check() {
    return {
      status: 'ok',
      role: 'ingest',
      warehouse: this.warehouseService.path,
      warehouseOpen: this.warehouseService.isOpen,
      timestamp: new Date().toISOString(),
    };
  }
}
