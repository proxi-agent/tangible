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
export { TX_HARRIS_2026 } from './schedules/tx-harris-2026.js';
export { TX_HARRIS_2026_SIC } from './schedules/tx-harris-2026-sic.js';
export { scheduleFor, scheduledJurisdictions, SCHEDULES } from './registry.js';
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
