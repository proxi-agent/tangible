import 'server-only';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { classificationLabel } from '@tangible/classification';
import { buildSavingsAnalysis } from '@/lib/analysis';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { engagementNotices } from '@/lib/notices';
import { engagementOpenYears } from '@/lib/open-years';
import { practiceSeason } from '@/lib/practice';
import { engagementResult } from '@/lib/result';
import { filingSeason } from '@/lib/season';
import { engagementReturns, engagementSites } from '@/lib/sites';
import {
  engagementAssetStats,
  engagementClassificationStats,
  fetchClient,
  fetchEngagement,
} from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';
import { tool, workspaceCitation, type AssistantTool } from './types';

/**
 * The firm's own record.
 *
 * Every tool here reads through the same builders the screens render —
 * `buildSavingsAnalysis`, `filingSeason`, `engagementResult`, `engagementOpenYears`
 * — for the reason the engagement ask already gives: an answer assembled from a
 * second, parallel reading of the tables would eventually disagree with the page
 * the reader is looking at, and there would be no way to tell which was wrong.
 *
 * Two things are deliberately not here. There is no write path — nothing
 * records a filing, disposes an asset, or answers an ask. And nothing returns a
 * whole register: the shapes below are summaries and capped pages, because a
 * turn that pours four thousand asset rows into a prompt has spent its budget
 * on the rows nobody asked about.
 *
 * What these tools return is confidential. Client registers, filed renditions
 * and the engagements around them are protected by Tax Code 22.27, and the
 * answers built from them are stored on a turn row, not published.
 */

const clientArg = z.string().describe('Client id (uuid) from list_clients.');
const engagementArg = z.string().describe('Engagement id (uuid) from get_client.');

/** A page of register rows. Large enough to reason over, small enough to send. */
const REGISTER_PAGE = 25;

const money = (n: number | null) => (n === null ? null : Math.round(n));

export const workspaceTools: AssistantTool[] = [
  tool({
    name: 'list_clients',
    source: 'workspace',
    description: `List the firm's clients with how many engagements each has. Call this first for any question that names a client by name rather than by id — every other workspace tool takes ids, and this is where they come from. With no search it lists the whole book, most recently touched first.`,
    args: z.object({
      search: z.string().nullable().describe('Match on client name, or null for all.'),
    }),
    async run({ search }) {
      const db = requireDb();
      const rows = await db
        .select({
          id: schema.clients.id,
          name: schema.clients.name,
          status: schema.clients.status,
          engagementCount: sql<number>`count(${schema.engagements.id})::int`,
          latestTaxYear: sql<number | null>`max(${schema.engagements.taxYear})::int`,
        })
        .from(schema.clients)
        .leftJoin(schema.engagements, eq(schema.engagements.clientId, schema.clients.id))
        .where(search?.trim() ? ilike(schema.clients.name, `%${search.trim()}%`) : undefined)
        .groupBy(schema.clients.id)
        .orderBy(desc(schema.clients.updatedAt))
        .limit(60);

      return {
        summary: `Workspace: ${rows.length} client(s)${search ? ` matching "${search}"` : ''}.`,
        data: rows,
        clientIds: rows.map((row) => row.id),
        citations: [workspaceCitation('/clients', 'Clients')],
      };
    },
  }),

  tool({
    name: 'get_client',
    source: 'workspace',
    description: `One client: status, its sites with addresses and appraisal-district account numbers, its Form 50-144 filing profile, and every engagement (tax year and county) opened for it. Use to find the engagement id for a tax year, to check whether a site has an account number, or to answer whether the filing profile is complete.`,
    args: z.object({ clientId: clientArg }),
    async run({ clientId }) {
      const db = requireDb();
      const client = await fetchClient(clientId);
      const [locations, profile, engagements] = await Promise.all([
        db
          .select()
          .from(schema.clientLocations)
          .where(eq(schema.clientLocations.clientId, clientId)),
        db
          .select()
          .from(schema.clientFilingProfiles)
          .where(eq(schema.clientFilingProfiles.clientId, clientId)),
        db
          .select()
          .from(schema.engagements)
          .where(eq(schema.engagements.clientId, clientId))
          .orderBy(desc(schema.engagements.taxYear)),
      ]);

      return {
        summary: `Workspace: ${client.name} — ${engagements.length} engagement(s), ${locations.length} site(s).`,
        data: {
          client: { id: client.id, name: client.name, status: client.status, notes: client.notes },
          sites: locations.map((l) => ({
            locationId: l.id,
            label: l.label,
            addressLine1: l.addressLine1,
            city: l.city,
            stateCode: l.stateCode,
            zip: l.zip,
            jurisdictionId: l.jurisdictionId,
            /** The roll account for this site. Null means a filing cannot cite one. */
            accountId: l.accountId,
          })),
          /**
           * Absent means no profile row at all; a present row with nulls is a
           * profile somebody started. The two block a filing the same way and
           * are fixed differently.
           */
          filingProfile: profile[0]
            ? {
                ownerName: profile[0].ownerName,
                mailingCity: profile[0].mailingCity,
                mailingStateCode: profile[0].mailingStateCode,
                businessDescription: profile[0].businessDescription,
                signerTitle: profile[0].signerTitle,
              }
            : null,
          engagements: engagements.map((e) => ({
            engagementId: e.id,
            taxYear: e.taxYear,
            jurisdictionId: e.jurisdictionId,
            sicCode: e.sicCode,
          })),
        },
        clientIds: [clientId],
        citations: [workspaceCitation(`/clients/${clientId}`, client.name)],
      };
    },
  }),

  tool({
    name: 'get_engagement',
    source: 'workspace',
    description: `One engagement's shape: the register's size and total cost, how much of it is disposed or missing an acquisition year or cost, how far classification has got, and the sites the register's location text was resolved to. Use for "where does this engagement stand", "how big is the register", "is anything unplaced". Property placed at no site is on no return, so the unplaced count is a filing problem and not a tidiness one.`,
    args: z.object({ engagementId: engagementArg }),
    async run({ engagementId }) {
      const { engagement, client } = await fetchEngagement(engagementId);
      const [assets, classification, sites, returns] = await Promise.all([
        engagementAssetStats(engagementId),
        engagementClassificationStats(engagementId),
        engagementSites(engagementId),
        engagementReturns(engagementId),
      ]);

      return {
        summary: `Workspace: ${client.name} ${engagement.taxYear} — ${assets.assetCount} asset(s), ${returns.returns.length} return(s) owed.`,
        data: {
          client: client.name,
          taxYear: engagement.taxYear,
          jurisdictionId: engagement.jurisdictionId,
          sicCode: engagement.sicCode,
          register: { ...assets, totalCost: money(assets.totalCost) },
          classification,
          sites: sites.map((s) => ({
            registerText: s.text,
            assetCount: s.assetCount,
            disposedCount: s.disposedCount,
            totalCost: money(s.totalCost),
            placements: s.placements,
            unplacedCount: s.unplacedCount,
          })),
          returnsOwed: returns.returns.length,
          unplacedCount: returns.unplacedCount,
          unplacedCost: money(returns.unplacedCost),
        },
        clientIds: [engagement.clientId],
        citations: [
          workspaceCitation(
            `/clients/${engagement.clientId}/engagements/${engagementId}`,
            `${client.name} ${engagement.taxYear}`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'search_register',
    source: 'workspace',
    description: `Search an engagement's fixed asset register by description, tag, register category, GL account or location text. Returns matching rows with cost, acquisition year, disposal state and the classification decided for each. Use for "do they have any forklifts", "what is the largest line", "what is in the leasehold improvements". Ordered by cost, largest first, and capped — the count of matches is reported even when the page is shorter.`,
    args: z.object({
      engagementId: engagementArg,
      search: z
        .string()
        .nullable()
        .describe('Text to match anywhere in the row. Null returns the largest lines.'),
      disposedOnly: z
        .boolean()
        .nullable()
        .describe('True for only rows the register marks disposed. Null for all rows.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .nullable()
        .describe(`How many rows. Default ${REGISTER_PAGE}.`),
    }),
    async run({ engagementId, search, disposedOnly, limit }) {
      const { engagement, client } = await fetchEngagement(engagementId);
      const db = requireDb();
      const v = schema.assetVersions;
      const term = search?.trim();
      const like = term ? `%${term}%` : null;

      const where = and(
        engagementAssetsWhere(engagementId),
        disposedOnly ? eq(v.isDisposed, true) : undefined,
        like
          ? or(
              ilike(v.description, like),
              ilike(v.assetTag, like),
              ilike(v.category, like),
              ilike(v.glAccount, like),
              ilike(v.location, like),
            )
          : undefined,
      );

      const [rows, [counted]] = await Promise.all([
        db
          .select({
            assetId: v.assetId,
            assetTag: v.assetTag,
            description: v.description,
            registerCategory: v.category,
            location: v.location,
            acquisitionYear: v.acquisitionYear,
            originalCost: v.originalCost,
            isDisposed: v.isDisposed,
            disposalDate: v.disposalDate,
            categoryKey: schema.assetClassifications.categoryKey,
            classificationStatus: schema.assetClassifications.status,
          })
          .from(v)
          .leftJoin(schema.assetClassifications, eq(schema.assetClassifications.assetId, v.assetId))
          .where(where)
          .orderBy(sql`${v.originalCost} desc nulls last`)
          .limit(limit ?? REGISTER_PAGE),
        db
          .select({
            n: sql<number>`count(*)::int`,
            cost: sql<number>`coalesce(sum(${v.originalCost}), 0)::double precision`,
          })
          .from(v)
          .where(where),
      ]);

      return {
        summary: `Workspace: ${counted?.n ?? 0} register row(s) match in ${client.name} ${engagement.taxYear}; showing ${rows.length}.`,
        data: {
          matched: counted?.n ?? 0,
          matchedCost: money(counted?.cost ?? 0),
          shown: rows.length,
          rows: rows.map((row) => ({
            ...row,
            originalCost: money(row.originalCost),
            category: row.categoryKey ? classificationLabel(row.categoryKey) : null,
          })),
        },
        clientIds: [engagement.clientId],
        citations: [
          workspaceCitation(
            `/clients/${engagement.clientId}/engagements/${engagementId}`,
            `${client.name} ${engagement.taxYear} register`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'get_savings_report',
    source: 'workspace',
    description: `The engagement's savings analysis: what the roll assesses today, what a corrected rendition would support, the leakage split into measured, modeled and leads, and every finding with its basis and disposition. Use for "how much can we save", "what did the analysis find", "why is this asset coming off". Findings that carry no dollar figure are screening questions whose answer the record does not hold — they are not zero-value findings.`,
    args: z.object({
      engagementId: engagementArg,
      findingLimit: z
        .number()
        .int()
        .min(1)
        .max(40)
        .nullable()
        .describe('How many findings to return, largest first. Default 15.'),
    }),
    async run({ engagementId, findingLimit }) {
      const { report, client, engagement } = await buildSavingsAnalysis(engagementId);
      const findings = [...report.findings].sort(
        (a, b) => (b.valueRemoved ?? -1) - (a.valueRemoved ?? -1),
      );
      const shown = findings.slice(0, findingLimit ?? 15);

      return {
        summary: `Workspace: ${client.name} ${report.taxYear} savings — ${report.findings.length} finding(s), estimated annual saving ${report.estimatedAnnualSaving === null ? 'not computable (no account linked)' : `$${Math.round(report.estimatedAnnualSaving).toLocaleString()}`}.`,
        data: {
          client: client.name,
          taxYear: report.taxYear,
          jurisdictionName: report.jurisdictionName,
          /** The district's figure. Null when no roll account is linked yet. */
          assessed: report.assessed,
          leakage: report.leakage,
          farOriginalCost: money(report.farOriginalCost),
          farImpliedValue: money(report.farImpliedValue),
          exemption: report.exemption,
          proposedTaxableValue: money(report.proposedTaxableValue),
          blendedTaxRate: report.blendedTaxRate,
          valueReduction: money(report.valueReduction),
          estimatedAnnualSaving: money(report.estimatedAnnualSaving),
          sic: report.sic,
          findingCount: report.findings.length,
          findings: shown.map(({ evidence: _evidence, ...finding }) => finding),
          findingsOmitted: Math.max(0, findings.length - shown.length),
        },
        clientIds: [engagement.clientId],
        citations: [
          workspaceCitation(
            `/clients/${engagement.clientId}/engagements/${engagementId}/report`,
            `${client.name} ${report.taxYear} savings report`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'get_season',
    source: 'workspace',
    description: `The engagement's returns board: every return owed, whether it is filed, ready or blocked, what is blocking it in the record gate's own words, the deadline each return is actually working to and any extension standing behind that date. Use for "can we file", "why is this blocked", "when is this due", "what went out". A return is ready when the record gate would accept it — the same test that runs when a filing is recorded.`,
    args: z.object({ engagementId: engagementArg }),
    async run({ engagementId }) {
      const { engagement, client } = await fetchEngagement(engagementId);
      const season = await filingSeason(engagementId);

      return {
        summary: `Workspace: ${client.name} ${season.taxYear} season — ${season.returns.filter((r) => r.status === 'filed').length} filed, ${season.returns.filter((r) => r.status === 'ready').length} ready, ${season.returns.filter((r) => r.status === 'blocked').length} blocked.`,
        data: {
          client: client.name,
          taxYear: season.taxYear,
          statutoryDueOn: season.dueOn,
          extendedDueOn: season.extendedDueOn,
          daysToDue: season.daysToDue,
          unplacedCount: season.unplacedCount,
          unplacedCost: money(season.unplacedCost),
          returns: season.returns.map((r) => ({
            label: r.label,
            accountId: r.accountId,
            jurisdictionId: r.jurisdictionId,
            status: r.status,
            assetCount: r.assetCount,
            registerCost: money(r.registerCost),
            renderedCost: money(r.renderedCost),
            blockers: r.blockers,
            warnings: r.warnings,
            dueOn: r.dueOn,
            daysToDue: r.daysToDue,
            extension: r.extension
              ? {
                  status: r.extension.status,
                  kind: r.extension.kind,
                  extendedTo: r.extension.extendedTo,
                }
              : null,
            filedOn: r.filing?.filedOn ?? null,
            /** Register movement since filing. Not a defect — a question. */
            driftedBy: money(r.driftedBy),
            noticedValue: r.notice?.appraisedValue ?? null,
          })),
        },
        clientIds: [engagement.clientId],
        citations: [
          workspaceCitation(
            `/clients/${engagement.clientId}/engagements/${engagementId}/filing`,
            `${client.name} ${season.taxYear} returns`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'get_notices',
    source: 'workspace',
    description: `Notices of appraised value recorded against an engagement, with the protest deadline actually being worked to, the statutory and printed dates behind it, the separate 22.30(b) penalty-waiver deadline where a rendition penalty was applied, the checks run against what we filed, and how any protest ended. Use for "when is the protest due", "did they apply a penalty", "what did the district come back with". One notice starts more than one clock and the shorter one is the one that gets missed.`,
    args: z.object({ engagementId: engagementArg }),
    async run({ engagementId }) {
      const { engagement, client } = await fetchEngagement(engagementId);
      const notices = await engagementNotices(engagementId);

      return {
        summary: `Workspace: ${notices.length} notice(s) recorded for ${client.name} ${engagement.taxYear}.`,
        data: notices.map((n) => ({
          site: n.locationLabel,
          accountId: n.accountId,
          districtName: n.districtName,
          noticedOn: n.noticedOn,
          deliveredOn: n.deliveredOn,
          appraisedValue: n.appraisedValue,
          priorYearValue: n.priorYearValue,
          renditionPenaltyApplied: n.renditionPenaltyApplied,
          protestFiledOn: n.protestFiledOn,
          protest: n.protest,
          checks: n.checks,
          resolution: n.resolution,
          /** What 25.25 leaves once the window has gone. Null while it is open. */
          correction: n.correction,
        })),
        clientIds: [engagement.clientId],
        citations: [
          workspaceCitation(
            `/clients/${engagement.clientId}/engagements/${engagementId}/filing`,
            `${client.name} ${engagement.taxYear} notices`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'get_open_years',
    source: 'workspace',
    description: `Prior years for this client where a Tax Code 25.25 correction route is still open, and the years where every route has closed. Each year carries which of (c), (c-1) and (d) is available, what bars the others, when each closes, and any motion already brought. Use for "can we do anything about last year", "what about the years before we were engaged". Closed years are returned too, because "no" is an answer a client is owed.`,
    args: z.object({ engagementId: engagementArg }),
    async run({ engagementId }) {
      const { engagement, client } = await fetchEngagement(engagementId);
      const years = await engagementOpenYears(engagementId);

      return {
        summary: `Workspace: ${client.name} — ${years.open.length} year(s) with a 25.25 route open, ${years.closed.length} closed.`,
        data: {
          open: years.open,
          closed: years.closed.map((y) => ({
            taxYear: y.taxYear,
            label: y.label,
            accountId: y.accountId,
            outlook: y.outlook,
          })),
        },
        clientIds: [engagement.clientId],
        citations: [
          workspaceCitation(
            `/clients/${engagement.clientId}/engagements/${engagementId}/priors`,
            `${client.name} prior years`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'get_result',
    source: 'workspace',
    description: `What the year came to for one engagement: each site's phase in the season, what we rendered, what the district noticed, what value stands now, the reduction where both sides are known, and the tax that reduction is worth. Use for "what did we save", "where did this land", "is the year finished". Totals are summed only over the sites where the figure exists and the counts say how many that was.`,
    args: z.object({ engagementId: engagementArg }),
    async run({ engagementId }) {
      const { engagement, client } = await fetchEngagement(engagementId);
      const result = await engagementResult(engagementId);

      return {
        summary: `Workspace: ${client.name} ${result.taxYear} result — ${result.settledCount} of ${result.siteCount} site(s) settled. ${result.standing}`,
        data: {
          client: client.name,
          ...result,
          sites: result.sites.map((s) => ({
            label: s.label,
            accountId: s.accountId,
            phase: s.phase,
            renderedCost: money(s.renderedCost),
            filedOn: s.filedOn,
            noticedValue: money(s.noticedValue),
            standingValue: money(s.standingValue),
            settledVia: s.settledVia,
            reduction: money(s.reduction),
            estimatedTaxReduction: money(s.estimatedTaxReduction),
            nextDeadline: s.nextDeadline,
            standing: s.standing,
          })),
        },
        clientIds: [engagement.clientId],
        citations: [
          workspaceCitation(
            `/clients/${engagement.clientId}/engagements/${engagementId}`,
            `${client.name} ${result.taxYear} result`,
          ),
        ],
      };
    },
  }),

  tool({
    name: 'get_practice_season',
    source: 'workspace',
    description: `The whole book for one tax year: every return across every client, what is filed, ready and blocked, the holds one fix would release, the practice-wide scoreboard, and which tax years have engagements at all. Use for questions above a single client — "what is left to file this season", "who is blocked", "how did the firm do". Counts sites, not drafts: one client can be ready at one location and blocked at another.`,
    args: z.object({
      taxYear: z
        .number()
        .int()
        .nullable()
        .describe('Tax year. Null uses the season the practice is currently working.'),
    }),
    async run({ taxYear }) {
      const season = await practiceSeason(taxYear ?? undefined);
      const blocked = season.returns.filter((r) => r.status === 'blocked');

      return {
        summary: `Workspace: practice ${season.taxYear} — ${season.clientCount} client(s), ${season.returns.length} return(s), ${blocked.length} blocked.`,
        data: {
          taxYear: season.taxYear,
          years: season.years,
          statutoryDueOn: season.dueOn,
          extendedDueOn: season.extendedDueOn,
          daysToDue: season.daysToDue,
          clientCount: season.clientCount,
          engagementCount: season.engagementCount,
          result: season.result,
          /** Blockers grouped, so one fix that releases six returns reads as one. */
          holds: season.holds,
          returns: season.returns.map((r) => ({
            client: r.clientName,
            label: r.label,
            status: r.status,
            dueOn: r.dueOn,
            daysToDue: r.daysToDue,
            blockerCount: r.blockers.length,
          })),
          unplacedCount: season.unplacedCount,
          unplacedCost: money(season.unplacedCost),
        },
        clientIds: season.returns.map((r) => r.clientId),
        citations: [workspaceCitation('/season', `Practice season ${season.taxYear}`)],
      };
    },
  }),
];
