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
