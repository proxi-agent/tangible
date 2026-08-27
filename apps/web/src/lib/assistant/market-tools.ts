import 'server-only';
import { z } from 'zod';
import {
  getAccount,
  getMarketOverview,
  getYearTrend,
  listAccounts,
  listOwners,
} from '@tangible/analytics';
import { listJurisdictionSummaries } from '@tangible/ingest/catalog';
import { AccountQuerySchema, SEGMENT_KEYS } from '@tangible/types';
import { getWarehouse } from '@/lib/warehouse';
import { marketCitation, tool, type AssistantTool } from './types';

/**
 * The public appraisal roll.
 *
 * Everything here reads DuckDB and none of it touches a client's own record.
 * The distinction is the whole reason these are separate tools rather than one
 * merged "look up a business": the roll holds what a district assessed, never
 * what a taxpayer rendered — Tax Code 22.27 keeps rendition contents
 * confidential — so an answer that treats an assessed value as the client's
 * reported position is wrong in a way that reads as authoritative.
 *
 * Coverage is uneven and the model has to know that rather than infer it from
 * an empty result. `list_jurisdictions` is therefore the first call for any
 * market question, and its description says so: a county with nothing loaded
 * and a county with no matching accounts look identical downstream.
 */

const jurisdictionArg = z
  .string()
  .describe('Jurisdiction id from list_jurisdictions, e.g. "tx-harris".');
const yearArg = z
  .number()
  .int()
  .describe("Tax year. Use one of the jurisdiction's availableYears.");

/** Accounts and owners are wide rows; a page of ten is plenty for an answer. */
const PAGE = 10;

export const marketTools: AssistantTool[] = [
  tool({
    name: 'list_jurisdictions',
    source: 'market',
    description: `List the counties in the public appraisal roll warehouse, with how many accounts are loaded, which tax years are available, the blended tax rate, and whether the county publishes a rendition filing flag at all. Call this first for any question about county or market data — it is what distinguishes "no accounts match" from "that county has nothing loaded", and it is where the jurisdiction id and valid tax years for every other market tool come from.`,
    args: z.object({
      search: z
        .string()
        .nullable()
        .describe('Filter by county, state, or name. Null lists everything.'),
    }),
    async run({ search }) {
      const all = await listJurisdictionSummaries(await getWarehouse());
      const needle = search?.trim().toLowerCase();
      const matches = needle
        ? all.filter((j) =>
            [j.name, j.county, j.state, j.id].some((field) => field.toLowerCase().includes(needle)),
          )
        : all;
      const loaded = matches.filter((j) => j.accountCount > 0);
      return {
        summary: `Market: ${matches.length} jurisdiction(s)${needle ? ` matching "${search}"` : ''}, ${loaded.length} with data loaded.`,
        data: matches.map((j) => ({
          id: j.id,
          name: j.name,
          state: j.state,
          county: j.county,
          accountCount: j.accountCount,
          availableYears: j.availableYears,
          latestYear: j.latestYear,
          blendedTaxRate: j.blendedTaxRate,
          /** False means no account in this county can be called a non-filer. */
          publishesFilingStatus: j.publishesFilingStatus,
          dataNotes: j.dataNotes,
          lastIngestedAt: j.lastIngestedAt,
        })),
        citations: [marketCitation('/data', 'Data sources')],
      };
    },
  }),

  tool({
    name: 'get_market_overview',
    source: 'market',
    description: `Headline figures for one county and tax year across the whole roll: total accounts, total assessed value, and per-segment counts, values, estimated annual tax and estimated annual penalty. Use for "how big is X county", "how many non-filers", sizing questions. Estimated tax and penalty are modelled from the county's blended rate, not read from a bill.`,
    args: z.object({ jurisdictionId: jurisdictionArg, taxYear: yearArg }),
    async run({ jurisdictionId, taxYear }) {
      const overview = await getMarketOverview(await getWarehouse(), jurisdictionId, taxYear);
      return {
        summary: `Market: ${jurisdictionId} ${taxYear} overview — ${overview.totalAccounts.toLocaleString()} accounts.`,
        data: overview,
        citations: [
          marketCitation(
            `/market?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
            `${jurisdictionId} ${taxYear} market overview`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'search_accounts',
    source: 'market',
    description: `Search accounts on the public roll by owner name or account number, with optional segment, city, state-class and value filters. Returns a page of accounts with assessed value, years on the roll, years unfiled, and estimated tax and penalty. Use to find a business on the roll, or to list the accounts matching a profile. This is the DISTRICT's view of an account — it never contains what the taxpayer reported.`,
    args: z.object({
      jurisdictionId: jurisdictionArg,
      taxYear: yearArg,
      search: z
        .string()
        .nullable()
        .describe('Owner name or account number, partial match. Null for no text filter.'),
      segments: z
        .array(z.enum(SEGMENT_KEYS))
        .nullable()
        .describe('Accounts must match every segment listed. Null for none.'),
      minValue: z.number().nullable().describe('Minimum latest assessed value, or null.'),
      minYearsUnfiled: z
        .number()
        .int()
        .nullable()
        .describe('Only accounts unfiled at least this many years, or null.'),
      limit: z.number().int().min(1).max(25).nullable().describe(`How many. Default ${PAGE}.`),
    }),
    async run({ jurisdictionId, taxYear, search, segments, minValue, minYearsUnfiled, limit }) {
      // Parsed through the same schema every account endpoint uses, so the
      // defaults the screens rely on — sort order, exempt handling — are the
      // ones the assistant gets too.
      const query = AccountQuerySchema.parse({
        jurisdictionId,
        taxYear,
        segments: segments ?? [],
        search: search?.trim() || undefined,
        minValue: minValue ?? undefined,
        minYearsUnfiled: minYearsUnfiled ?? undefined,
        limit: limit ?? PAGE,
      });
      const page = await listAccounts(await getWarehouse(), query);
      return {
        summary: `Market: ${page.total.toLocaleString()} account(s) match in ${jurisdictionId} ${taxYear}; showing ${page.items.length}.`,
        data: {
          total: page.total,
          shown: page.items.length,
          accounts: page.items.map(({ history: _history, ...account }) => account),
        },
        citations: page.items.map((account) =>
          marketCitation(
            `/accounts/${account.accountId}?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
            `${account.ownerName || account.accountId} (account ${account.accountId})`,
          ),
        ),
      };
    },
  }),

  tool({
    name: 'get_account',
    source: 'market',
    description: `One account on the public roll with its full year-by-year history: assessed value, whether a rendition was filed and whether it was late, and estimated tax and penalty per year. Use when a question is about a specific account number, or to check what the district did with a client's site after a return went out. A null renditionFiled means the county does not publish that flag, which is different from a false.`,
    args: z.object({
      jurisdictionId: jurisdictionArg,
      taxYear: yearArg,
      accountId: z.string().describe('The district account number.'),
    }),
    async run({ jurisdictionId, taxYear, accountId }) {
      const account = await getAccount(await getWarehouse(), jurisdictionId, taxYear, accountId);
      if (!account) {
        return {
          summary: `Market: no account ${accountId} in ${jurisdictionId} for ${taxYear}.`,
          data: null,
        };
      }
      return {
        summary: `Market: account ${accountId} — ${account.ownerName ?? 'unnamed owner'}, ${account.history.length} year(s) of history.`,
        data: account,
        citations: [
          marketCitation(
            `/accounts/${accountId}?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
            `${account.ownerName || accountId} (account ${accountId})`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'list_owners',
    source: 'market',
    description: `Accounts grouped by owner for one county and year — how many accounts an entity holds, their total assessed value, how many are unfiled, and the estimated penalty across them. Use for questions about a business with several locations, or about the largest holders in a county.`,
    args: z.object({
      jurisdictionId: jurisdictionArg,
      taxYear: yearArg,
      search: z.string().nullable().describe('Owner name, partial match, or null.'),
      minAccounts: z
        .number()
        .int()
        .min(1)
        .nullable()
        .describe('Only entities holding at least this many accounts. Default 1.'),
      limit: z.number().int().min(1).max(25).nullable().describe(`How many. Default ${PAGE}.`),
    }),
    async run({ jurisdictionId, taxYear, search, minAccounts, limit }) {
      const page = await listOwners(await getWarehouse(), {
        jurisdictionId,
        taxYear,
        segments: [],
        minAccounts: minAccounts ?? 1,
        search: search?.trim() || undefined,
        limit: limit ?? PAGE,
        offset: 0,
      });
      return {
        summary: `Market: ${page.total.toLocaleString()} owner(s) match in ${jurisdictionId} ${taxYear}; showing ${page.items.length}.`,
        data: { total: page.total, owners: page.items },
        citations: [
          marketCitation(
            `/owners?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
            `${jurisdictionId} ${taxYear} owner rollup`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'get_year_trend',
    source: 'market',
    description: `How a county's roll moved year over year — account counts, assessed value, and filing rates by tax year. Use for "is this growing", "how has the non-filer count changed", or to check which years actually hold data before drawing a comparison across them.`,
    args: z.object({ jurisdictionId: jurisdictionArg }),
    async run({ jurisdictionId }) {
      const trend = await getYearTrend(await getWarehouse(), jurisdictionId);
      return {
        summary: `Market: ${jurisdictionId} trend across ${trend.length} year(s).`,
        data: trend,
        citations: [
          marketCitation(`/market?jurisdictionId=${jurisdictionId}`, `${jurisdictionId} trend`),
        ],
      };
    },
  }),
];
