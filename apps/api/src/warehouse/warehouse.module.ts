import { Global, Module } from '@nestjs/common';
import { WarehouseService } from './warehouse.service.js';

/** Global so every feature module can inject the warehouse without re-importing. */
@Global()
@Module({
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
