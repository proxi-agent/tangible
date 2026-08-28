import 'server-only';
import { desc, eq, inArray } from 'drizzle-orm';
import {
  labelsFrom,
  runGate,
  ruleStatuses,
  scoreLabels,
  type DecisionRecord,
} from '@tangible/eval';
import { SAVINGS_RULES_VERSION } from '@tangible/savings';
import type {
  DetectionSignal,
  EvalLabel,
  QualityReport,
  QualityView,
  RuleStatus,
} from '@tangible/types';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * How well the engine is doing, measured off the work the firm already did.
 *
 * There is no labelling tool here and there is not going to be one. Every time
 * a reviewer accepts or rejects a row in the queue, that is a person with a
 * licence saying whether a detector was right about a specific asset — which is
 * exactly a label, stamped with the score and the signals the row carried at
 * the moment they saw it. The review queue is a labelling pipeline wearing a
 * workflow, and this file is the part that reads it as one.
 *
 * Two consequences worth stating. The dataset grows by doing the work rather
 * than by anyone finding time for it, which is the only version of this that
 * survives contact with a filing season. And the labels are worth something,
 * because they were made under the pressure of a return that had to be right,
 * not by someone clicking through a labelling UI at the end of a Friday.
 *
 * Client decisions are collected and reported separately. A controller
 * rejecting a row is real information — often better information, since they
 * know what happened to the machine — but "the client did not want to make this
 * argument" and "the detector was wrong" are different facts, and averaging
 * them together would flatter or damn the engine for the wrong reason.
 */

/** The savings engine's own findings. Register comparison is a different animal. */
const SOURCE = 'savings';

/**
 * A cleared decision reads back as no decision, which is what it means. It
 * still arrives here so that undoing an accept moves the row out of the
 * judged set rather than leaving the old verdict standing.
 */

export async function qualityView(today: string): Promise<QualityView> {
  const labels = await harvestLabels();
  const firm = labels.filter((label) => label.decidedByAudience !== 'client');
  const client = labels.filter((label) => label.decidedByAudience === 'client');

  const generatedAt = new Date().toISOString();
  const report = scoreLabels(firm, generatedAt);

  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label.engagementId, (counts.get(label.engagementId) ?? 0) + 1);
  }

  return {
    report,
    clientReport: scoreLabels(client, generatedAt),
    rules: withLabelCounts(ruleStatuses(today), firm),
    gate: runGate({ today }),
    engagements: await engagementLabels(counts),
  };
}

/**
 * Every decision ever recorded, read back as a label.
 *
 * Deliberately unbounded and unfiltered by date. The whole point of a golden
 * dataset is that it accumulates, and a rolling window would quietly discard
 * the rare finding types — the ones with the fewest labels are exactly the ones
 * whose precision nobody can state.
 */
export async function harvestLabels(): Promise<EvalLabel[]> {
  const db = requireDb();
  const rows = await db
    .select({
      engagementId: schema.findingRowDecisions.engagementId,
      findingKey: schema.findingRowDecisions.findingKey,
      assetId: schema.findingRowDecisions.assetId,
      status: schema.findingRowDecisions.status,
      decidedAt: schema.findingRowDecisions.decidedAt,
      decidedBy: schema.findingRowDecisions.decidedBy,
      decidedByAudience: schema.findingRowDecisions.decidedByAudience,
      decidedValue: schema.findingRowDecisions.decidedValue,
      decidedTaxAtRisk: schema.findingRowDecisions.decidedTaxAtRisk,
      confidenceTier: schema.findingRowDecisions.confidenceTier,
      confidenceScore: schema.findingRowDecisions.confidenceScore,
      signals: schema.findingRowDecisions.signals,
      taxYear: schema.engagements.taxYear,
      jurisdictionId: schema.engagements.jurisdictionId,
    })
    .from(schema.findingRowDecisions)
    .innerJoin(
      schema.engagements,
      eq(schema.findingRowDecisions.engagementId, schema.engagements.id),
    )
    .where(eq(schema.findingRowDecisions.source, SOURCE))
    .orderBy(desc(schema.findingRowDecisions.decidedAt));

  const records: DecisionRecord[] = rows.map((row) => ({
    /**
     * A row is a finding about an asset, so that pair is its identity — the
     * same asset can legitimately carry a ghost-assets decision and a
     * situs-error one, and they are two labels, not one changed twice.
     */
    rowKey: `${row.findingKey}::${row.assetId}`,
    findingKey: row.findingKey,
    assetId: row.assetId,
    engagementId: row.engagementId,
    jurisdictionId: row.jurisdictionId,
    taxYear: row.taxYear,
    status: row.status,
    decidedAt: row.decidedAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedByAudience: row.decidedByAudience === 'client' ? 'client' : 'firm',
    confidenceScore: row.confidenceScore,
    confidenceTier: tierOf(row.confidenceTier),
    signals: (row.signals as DetectionSignal[] | null) ?? [],
    decidedValue: row.decidedValue,
    decidedTaxAtRisk: row.decidedTaxAtRisk,
    /**
     * The table does not record which rules version raised the row, so this is
     * the version running now. It is honest for the recent past and wrong for
     * a decision made before a rules bump — which is why the dashboard reports
     * precision by finding and not by version, and why a real version-over-
     * version comparison needs the column added before it can be believed.
     */
    rulesVersion: SAVINGS_RULES_VERSION,
  }));

  return labelsFrom(records);
}

/** The column is free text; the harness's tiers are three. Anything else is absent. */
function tierOf(value: string | null): 'high' | 'medium' | 'low' | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

function withLabelCounts(statuses: RuleStatus[], labels: EvalLabel[]): RuleStatus[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label.findingKey, (counts.get(label.findingKey) ?? 0) + 1);
  }
  return statuses.map((status) => {
    if (status.kind !== 'detector') return status;
    const key = status.provenance.ruleId.replace(/^detector:/, '');
    return { ...status, labelCount: counts.get(key) ?? 0 };
  });
}

async function engagementLabels(counts: Map<string, number>): Promise<QualityView['engagements']> {
  if (counts.size === 0) return [];
  const db = requireDb();
  const rows = await db
    .select({
      id: schema.engagements.id,
      taxYear: schema.engagements.taxYear,
      clientName: schema.clients.name,
    })
    .from(schema.engagements)
    .innerJoin(schema.clients, eq(schema.engagements.clientId, schema.clients.id))
    .where(inArray(schema.engagements.id, [...counts.keys()]));

  return rows
    .map((row) => ({ ...row, labels: counts.get(row.id) ?? 0 }))
    .sort((a, b) => b.labels - a.labels);
}
