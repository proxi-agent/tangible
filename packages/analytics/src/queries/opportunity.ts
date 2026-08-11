import type { OpportunityModel, OpportunityModelInput } from '@tangible/types';
import { SEGMENT_PREDICATES } from '../predicates.js';
import { accountSeriesCte } from '../series.js';
import { num, numOrNull } from '../sql.js';
import type { Warehouse } from '../warehouse.js';

/**
 * Sizes a segment as a subscription business.
 *
 * Deliberately thin: it multiplies a real account count by two stated
 * assumptions (price, conversion) and reports the ceiling alongside the
 * expected case. The number that matters is `medianCustomerSavings` — if the
 * subscription costs more than the penalty it removes, the pitch does not work
 * regardless of how large the segment is.
 */
export async function getOpportunityModel(
  warehouse: Warehouse,
  input: OpportunityModelInput,
): Promise<OpportunityModel> {
  const predicate = SEGMENT_PREDICATES[input.segment];

  const sql = /* sql */ `
    WITH ${accountSeriesCte(input.jurisdictionId, input.taxYear)}
    SELECT
      count(*)                                    AS addressable_accounts,
      coalesce(sum(estimated_annual_penalty), 0)  AS current_penalty_burden,
      median(estimated_annual_penalty)            AS median_penalty
    FROM series
    WHERE ${predicate};
  `;

  const row = await warehouse.queryOne<Record<string, unknown>>(sql);

  const addressableAccounts = num(row?.addressable_accounts);
  const medianPenaltyPerAccount = numOrNull(row?.median_penalty);
  const expectedAccounts = addressableAccounts * input.conversionRate;

  return {
    input,
    addressableAccounts,
    totalAddressableRevenue: addressableAccounts * input.pricePerAccount,
    expectedAccounts,
    expectedRevenue: expectedAccounts * input.pricePerAccount,
    currentPenaltyBurden: num(row?.current_penalty_burden),
    medianPenaltyPerAccount,
    medianCustomerSavings:
      medianPenaltyPerAccount === null ? null : medianPenaltyPerAccount - input.pricePerAccount,
  };
}
