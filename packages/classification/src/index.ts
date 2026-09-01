export {
  dedupeKey,
  fingerprint,
  hasSomethingToClassify,
  type ClassificationInput,
} from './fingerprint.js';
export {
  AUTO_ACCEPT_CONFIDENCE,
  decideFromAi,
  decideFromHuman,
  decideFromMemory,
  decideUnclassifiable,
  isValuable,
  type AiAnswer,
  type Decision,
  type MemoryRecord,
} from './decide.js';
export {
  BUNDLE_TERMS,
  INCLUDED_TERMS,
  bundledComponents,
  includedComponents,
  mentions,
  type BundleSignal,
  type BundleTerm,
  type IncludedSignal,
} from './bundles.js';
// The vocabulary above, held up against what the firm actually settled. Every
// output is a proposal; nothing in here rewrites the list it grades.
export {
  CHALLENGE_PRECISION,
  MIN_MENTIONS,
  MIN_SUPPORT,
  PROPOSE_PRECISION,
  reviewBundleVocabulary,
  type BundleTermChallenge,
  type BundleTermProposal,
  type BundleVocabularyReview,
  type SettledDescription,
  type WithheldPhrase,
} from './bundle-learning.js';
export {
  CLASSIFICATION_KEYS,
  EXCLUSION_CATEGORIES,
  EXCLUSION_KEYS,
  classificationLabel,
  classificationOptions,
  isExclusion,
  isKnownClassification,
  type ClassificationKey,
  type ClassificationOption,
  type ExclusionKey,
  type ExclusionRule,
} from './vocabulary.js';
export {
  AUTO_ACCEPT_CONFIDENCE as LINE_AUTO_ACCEPT_CONFIDENCE,
  LINE_MAPPING_KEYS,
  WORDING_SCHEDULES,
  isComparable,
  isKnownLineMapping,
  isMixed,
  lineMappingLabel,
  lineTypeFingerprint,
  mapFromAi,
  mapFromHuman,
  mapFromMemory,
  mapFromSchedule,
  mapUnmappable,
  scheduleDecides,
  type LineAnswer,
  type LineMapping,
  type LineMappingKey,
  type LineMemoryRecord,
} from './line-types.js';
