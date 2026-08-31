export {
  appraise,
  lookupSicProfile,
  totalPortfolio,
  type Appraisal,
  type AppraisalGap,
  type AppraisalInput,
  type AppraisalResult,
  type LifeSource,
  type PortfolioTotals,
} from './appraise.js';
export {
  CATEGORY_BY_KEY,
  HCAD_CATEGORIES,
  HCAD_CATEGORY_KEYS,
  categoriesFor,
  categoryFor,
  type HcadCategoryKey,
} from './categories.js';
export {
  LIFE_CLASSES,
  SPECIAL_SCHEDULES,
  type CategoryRule,
  type DepreciationSchedule,
  type LifeClass,
  type ScheduleGap,
  type ScheduleStatus,
  type SicProfile,
  type SpecialSchedule,
} from './types.js';
export { FL_DOR_2026 } from './schedules/fl-dor-2026.js';
export { TX_BEXAR_2026 } from './schedules/tx-bexar-2026.js';
export { TX_COLLIN_2026 } from './schedules/tx-collin-2026.js';
export { TX_DALLAS_2026 } from './schedules/tx-dallas-2026.js';
export { TX_TARRANT_2026 } from './schedules/tx-tarrant-2026.js';
export { TX_TRAVIS_2026 } from './schedules/tx-travis-2026.js';
export { TX_HARRIS_2026 } from './schedules/tx-harris-2026.js';
export { TX_HARRIS_2026_SIC } from './schedules/tx-harris-2026-sic.js';
export {
  scheduleFor,
  scheduledJurisdictions,
  SCHEDULES,
  type ScheduledJurisdiction,
} from './registry.js';
export {
  project,
  type ProjectedYear,
  type Projection,
  type ProjectionResult,
} from './projection.js';
export {
  covers,
  inEffect,
  provenanceFor,
  scheduleProvenance,
  staleReason,
  RULE_SCOPE_REQUIRED,
} from './provenance.js';
export {
  accountRate,
  accountRateAsOf,
  blendAccountRates,
  taxForAccount,
  rateSourceFor,
  type AccountRate,
  type AccountRateResult,
  type AccountTax,
  type UnitPlacement,
  type UnitShare,
  type UnitTax,
} from './rates/account.js';
export {
  RATE_TABLES,
  latestAdoptedYear,
  rateProvenance,
  rateTableFor,
  ratedJurisdictions,
} from './rates/registry.js';
export {
  perDollar,
  type RateTable,
  type RateTableStatus,
  type TaxUnitRate,
} from './rates/types.js';
export { TX_HARRIS_RATES_2025 } from './rates/tx-harris-2025.js';
export { TX_HARRIS_RATES_2026 } from './rates/tx-harris-2026.js';
