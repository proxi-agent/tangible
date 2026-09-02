import type { FarMappingProposal, MappingMemoryHint } from '@tangible/types';

/**
 * May this mapping be applied without a person looking at it?
 *
 * The question only exists because of what sits downstream of a confirm: the
 * register becomes assets, the assets become a valuation, and the valuation
 * becomes a number a client reads and a return the firm signs. A mapping
 * confirmed by nobody is a claim nobody made.
 *
 * So the bar is built out of things that are not the model's opinion of
 * itself. `verifyMapping` has already applied this exact mapping to the real
 * rows and footed the mapped costs against the total the register prints; that
 * result arrives here as `proposal.verification`, and every check in it has to
 * have passed. The confidence figure is a secondary condition, not the primary
 * one — a model that hedges while its mapping foots is still telling us
 * something, but a model that is sure of a mapping that does not foot is not
 * getting through on confidence.
 *
 * The other two clauses are about knowing what you do not know. An open ask is
 * the model's own statement that a question is unanswered, and confirming past
 * one is answering it by guessing. A conflicted header is this firm's record
 * that two reviewers already read that column two different ways — a machine
 * settling it silently would be picking a side in an argument it did not
 * witness.
 *
 * Nothing here is a judgement about the *tax*. It is a judgement about whether
 * the file was read correctly, which is the only question a confirm actually
 * answers.
 */

/**
 * How sure the mapping model must be, on top of every deterministic check
 * passing. Deliberately the weaker of the two conditions: the checks do the
 * work, and this catches the case where the numbers happen to line up under a
 * mapping the model itself would not defend.
 */
export const UNATTENDED_CONFIDENCE = 0.8;

/** Fields without which a register cannot be valued, whatever else it maps. */
const REQUIRED_FIELDS = ['description', 'originalCost'] as const;

/** An asset with no age cannot be depreciated; any of these dates supplies one. */
const AGE_FIELDS = ['acquisitionDate', 'acquisitionYear', 'inServiceDate'] as const;

export interface UnattendedInput {
  proposal: FarMappingProposal;
  /** Questions still outstanding with the client, in the words they were asked. */
  openAsks: string[];
  /** Header hints for this file that reviewers have settled two ways. */
  conflicted: MappingMemoryHint[];
}

export interface UnattendedVerdict {
  clears: boolean;
  /** Why, in words a preparer can act on — printed whether it clears or not. */
  reason: string;
}

export function mappingClearsBar(input: UnattendedInput): UnattendedVerdict {
  const { proposal, openAsks, conflicted } = input;

  const verification = proposal.verification;
  if (!verification) {
    return {
      clears: false,
      reason: 'The mapping was proposed without being checked against the rows.',
    };
  }
  const failed = verification.checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    return { clears: false, reason: failed.map((check) => check.detail).join(' ') };
  }

  if (proposal.confidence < UNATTENDED_CONFIDENCE) {
    return {
      clears: false,
      reason: `Every check passed, but the proposal is only ${percent(proposal.confidence)} sure of itself.`,
    };
  }

  const included = proposal.sheets.filter((sheet) => sheet.include);
  if (included.length === 0) {
    return { clears: false, reason: 'The mapping includes no sheets.' };
  }
  for (const sheet of included) {
    const fields = new Set(
      sheet.columns.map((column) => column.field).filter((field) => field !== null),
    );
    const missing = REQUIRED_FIELDS.filter((field) => !fields.has(field));
    if (missing.length > 0) {
      return {
        clears: false,
        reason: `"${sheet.sheetName}" maps no ${missing.join(' and no ')} column.`,
      };
    }
    if (!AGE_FIELDS.some((field) => fields.has(field))) {
      return {
        clears: false,
        reason: `"${sheet.sheetName}" maps no acquisition date — nothing on it could be depreciated.`,
      };
    }
  }

  if (openAsks.length > 0) {
    return {
      clears: false,
      reason:
        openAsks.length === 1
          ? `A question is open with the client: ${openAsks[0]}`
          : `${openAsks.length} questions are open with the client, starting with: ${openAsks[0]}`,
    };
  }

  for (const hint of conflicted) {
    const sheet = included.find((one) => one.sheetName === hint.sheetName);
    const column = sheet?.columns.find((one) => one.index === hint.index);
    if (column && column.field !== null) {
      return {
        clears: false,
        reason: `Reviewers here have read the "${hint.header}" column two ways — as ${hint.field}, and as ${hint.conflictingField ?? 'something else'}.`,
      };
    }
  }

  return {
    clears: true,
    reason: `Every check against the rows passed and the proposal was ${percent(proposal.confidence)} sure.`,
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
