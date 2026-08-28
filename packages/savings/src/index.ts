export { analyzeSavings, type SavingsAsset, type SavingsInput } from './analyze.js';
export {
  ruleLine,
  rulesFor,
  splitForAsset,
  splitInvoice,
  type AssessabilityRule,
  type InvoiceSplitResult,
  type LineRuling,
  type SplitLine,
} from './assessability.js';
export {
  CONFIDENCE_THRESHOLDS,
  baseFor,
  confidenceFor,
  signal,
  tierFor,
  type FittedScore,
} from './confidence.js';
export {
  fitDetectionModel,
  modelScore,
  ruleScore,
  MIN_LABELS,
  MIN_MINORITY,
  PRIOR_OBSERVATIONS,
  type DetectionModelFit,
  type FittedCoefficients,
  type ModelLabel,
} from './model.js';
export {
  bookLife,
  tokenSimilarity,
  type Candidate,
  type DetectorContext,
  type InvoiceSplit,
  type PriorFiling,
  type PriorLine,
  type RowPlan,
} from './detectors.js';
export { TX_EXEMPTION_2026, FL_EXEMPTION, exemptionFor, exemptionForSites } from './exemptions.js';
export { topQueue, QUEUE_SIZE, type QueueDecision } from './queue.js';
export {
  acceptanceFor,
  basisFromBlendedRate,
  chainFrom,
  expectedRecovery,
  recoveryModel,
  routeFor,
  routesFor,
  routeYears,
  routeAuthority,
  taxOn,
  type AcceptanceEvidenceLine,
  type RecoveryInput,
  type RecoveryModel,
  type RecoveryRoute,
} from './recovery.js';
export { foldLocation } from './signals.js';
export { SAVINGS_RULES_VERSION } from './version.js';
export { DETECTOR_RULES, DETECTOR_RULE_KEYS, ruleFor } from './rules.js';
export {
  learnAcceptance,
  MIN_OBSERVATIONS,
  PRIOR_STRENGTH,
  LOCAL_PRIOR_STRENGTH,
  type AcceptanceEvidence,
  type AcceptanceObservation,
  type LearnedAcceptance,
} from './acceptance.js';
