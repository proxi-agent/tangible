import 'server-only';
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import {
  buildForm50144,
  buildRendition,
  planFormFill,
  renderForm50144,
  type Form50144,
  type FormAudience,
  type FormFillPlan,
  type FormOmission,
  type FormParty,
  type FormSigner,
  type RenditionAsset,
} from '@tangible/filing';
import type { ClientFilingProfileRow } from '@tangible/db';
import type {
  ClassificationStatus,
  EngagementReturn,
  EngagementReturns,
  FilingBlocker,
  Rendition,
  RenditionBasis,
} from '@tangible/types';
import { scheduleFor } from '@tangible/valuation';
import { currentActor } from '@/lib/actor';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { renditionPositions } from '@/lib/findings';
import { HttpError } from '@/lib/route';
import { engagementReturns } from '@/lib/sites';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export interface RenditionOptions {
  basis: RenditionBasis;
  filedByAgent: boolean;
  /**
   * Which of the engagement's returns to build.
   *
   * Optional because most engagements are one site and nobody should have to
   * name it. Omitted, {@link resolveReturn} takes the only return there is;
   * where there are several it builds the register whole and blocks, which is
   * the honest answer to "show me the form" when the answer is "there are two".
   */
  locationId?: string | null;
}

/**
 * The engagement's rendition, built the one way.
 *
 * The draft screen, the printable form and anything that files later all have
 * to agree about what is on the return, and the cheapest way to guarantee that
 * is for them to call the same function. Same reasoning as `buildSavingsAnalysis`
 * — the moment two callers assemble the inputs themselves, they drift, and the
 * drift shows up on a document somebody signed.
 */
/**
 * Which return we are building, and which property is on it.
 *
 * A rendition states one account's property, so the target has to be settled
 * before a single asset is read. Three cases, and the middle one is the whole
 * reason this exists:
 *
 * - a site named explicitly, which must be one this engagement actually owes;
 * - nothing named and one return owed, which is that return — the ordinary
 *   single-site engagement, where making somebody pick from a list of one
 *   would be ceremony;
 * - nothing named and several owed, which is no return at all. The register is
 *   built whole so the screen has something true to show, and the form blocks.
 */
async function resolveReturn(
  engagementId: string,
  locationId: string | null | undefined,
): Promise<{ target: EngagementReturn | null; owed: EngagementReturns }> {
  const owed = await engagementReturns(engagementId);
  if (locationId) {
    const target = owed.returns.find((r) => r.locationId === locationId);
    if (!target) {
      throw new HttpError(404, 'That site holds none of this engagement’s property.');
    }
    return { target, owed };
  }
  return { target: owed.returns.length === 1 ? owed.returns[0]! : null, owed };
}

/**
 * The rows on one return.
 *
 * The subtle case is property the register placed nowhere. With a single site
 * it stays on the return: the client has nowhere else to put it, filing it is
 * the safe position under 22.28, and the form says out loud that it was
 * assumed. With two sites we genuinely do not know which, so it stays off every
 * return and blocks — a guess there would file one district's property in
 * another's, and the client would find out from a bill.
 */
function returnAssetsWhere(
  engagementId: string,
  target: EngagementReturn | null,
  owed: EngagementReturns,
): SQL | undefined {
  if (!target) return engagementAssetsWhere(engagementId);
  const placement =
    owed.returns.length === 1
      ? or(eq(schema.assets.locationId, target.locationId), isNull(schema.assets.locationId))
      : eq(schema.assets.locationId, target.locationId);
  return and(engagementAssetsWhere(engagementId), placement);
}

/**
 * The client's filing profile, or null where nobody has filled one in yet.
 *
 * One row per client by primary key, so the array is the row or it is empty.
 */
async function filingProfile(clientId: string): Promise<ClientFilingProfileRow | null> {
  const rows = await requireDb()
    .select()
    .from(schema.clientFilingProfiles)
    .where(eq(schema.clientFilingProfiles.clientId, clientId));
  return rows[0] ?? null;
}

/**
 * The rendition, plus the two things about it that the document itself does not
 * carry: which return it is, and which assets went into it.
 *
 * The asset ids are here rather than re-queried by callers that want them
 * because the predicate deciding what is on a return lives in exactly one place
 * ({@link returnAssetsWhere}) and asking it twice is how a filing record comes
 * to disagree with the form it froze.
 */
async function renditionParts(
  engagementId: string,
  options: RenditionOptions,
): Promise<{
  rendition: Rendition;
  assetIds: string[];
  target: EngagementReturn | null;
  owed: EngagementReturns;
}> {
  const { engagement, client } = await fetchEngagement(engagementId);
  const db = requireDb();
  // The decision log, read alongside the register. Empty until somebody has
  // committed a set, which is the normal state of a new engagement.
  //
  // Engagement-wide on purpose, even when the form is one site's. A position
  // names a category and re-derives its property from whatever register it is
  // handed, so the same accepted finding takes the same class of property off
  // each site's return, measured against that site — which is what accepting it
  // meant.
  const { target, owed } = await resolveReturn(engagementId, options.locationId);
  const [positions, profile] = await Promise.all([
    renditionPositions(engagementId),
    filingProfile(client.id),
  ]);
  const rows = await db
    .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(returnAssetsWhere(engagementId, target, owed));

  const assets: RenditionAsset[] = rows.map(({ asset, classification }) => ({
    id: asset.assetId,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    isDisposed: asset.isDisposed,
    categoryKey: classification?.categoryKey ?? null,
    lifeClassOverride: classification?.lifeClassOverride ?? null,
    status: (classification?.status as ClassificationStatus | undefined) ?? null,
  }));

  // The site's county where it has one — the schedules that value this property
  // are the ones published where it stood, not where the engagement was opened.
  const jurisdictionId = target?.jurisdictionId ?? engagement.jurisdictionId;

  const rendition = buildRendition({
    engagementId,
    clientName: client.name,
    taxYear: engagement.taxYear,
    jurisdictionId,
    accountId: target?.accountId ?? null,
    sicCode: engagement.sicCode,
    assets,
    positions,
    schedule: jurisdictionId ? (scheduleFor(jurisdictionId, engagement.taxYear) ?? null) : null,
    basis: options.basis,
    filedByAgent: options.filedByAgent,
    // The draft screen and the printed form both ask whether an agent may sign
    // this. They have to give the same answer, and the answer lives in the
    // filing profile, so the draft reads it too rather than assuming the worst.
    agentAppointmentDate: profile?.agentAppointmentDate ?? null,
    generatedAt: new Date().toISOString(),
  });

  // Where the property stood is an engagement-level fact, so the filing package
  // — which is handed one return's assets and nothing about the others — has no
  // way to raise it. The draft would otherwise show a register spanning two
  // sites under a heading that says one form.
  rendition.blockers.push(...situsProblems(target, owed));
  return { rendition, assetIds: assets.map((asset) => asset.id), target, owed };
}

export async function buildEngagementRendition(
  engagementId: string,
  options: RenditionOptions,
): Promise<Rendition> {
  return (await renditionParts(engagementId, options)).rendition;
}

/**
 * The owner's mailing address, from the filing profile.
 *
 * Kept separate from {@link locationAddressLines} on purpose even though the
 * shape is nearly the same. A situs is where property stood on January 1 and
 * comes off a location row; a mailing address is where the district sends the
 * notice that starts the 41.44 protest clock, and comes off the taxpayer. Collapsing them
 * into one helper is how a warehouse ends up receiving the appeal deadline.
 */
const mailingLines = (profile: ClientFilingProfileRow | null): string[] =>
  profile === null
    ? []
    : [
        profile.mailingAddressLine1,
        profile.mailingAddressLine2,
        [profile.mailingCity, profile.mailingStateCode].filter(Boolean).join(', '),
        profile.mailingZip,
      ].filter((line): line is string => Boolean(line && line.trim()));

export interface EngagementForm {
  form: Form50144;
  /** The engagement and client names, for the page chrome. */
  clientName: string;
  taxYear: number;
  /**
   * Which of the engagement's returns this is, and how many there are. The page
   * needs both: a form that is one of two has to say so on its face, and the
   * picker that switches between them has to know what to offer.
   */
  target: EngagementReturn | null;
  owed: EngagementReturns;
  /**
   * What the printed PDF can and cannot carry, which the document model has no
   * way to know — it describes the rendition, not the piece of paper. Kept
   * separate from `form.omissions` rather than merged into it, because the two
   * lists answer different questions and folding them together would ask the
   * same one twice.
   */
  printed: { revision: string; blocked: string | null; overflow: FormFillPlan['overflow'] };
}

/**
 * Form 50-144 for this engagement, with everything the data cannot answer
 * surfaced rather than left blank.
 *
 * The taxpayer answers the register cannot give — who the owner is on the roll,
 * where the notices go, what the business does in its own words, and what
 * authorises us to sign — come from the client's filing profile. Where there is
 * no profile, or a box in it is still empty, the value is passed through as
 * absent on purpose: `buildForm50144` turns each into an omission naming what
 * is missing and why it matters, which is a far better state to ship than a
 * quietly empty box on a sworn document.
 */
export async function formInputs(engagementId: string, options: RenditionOptions) {
  const { engagement, client } = await fetchEngagement(engagementId);
  const [parts, actor, profile] = await Promise.all([
    renditionParts(engagementId, options),
    currentActor(),
    filingProfile(client.id),
  ]);

  const { rendition, assetIds, target, owed } = parts;

  const party: FormParty = {
    // The roll name and the name we file the client under are usually the same
    // and legally need not be. Ours stands until somebody records that it does.
    ownerName: profile?.ownerName ?? client.name,
    mailingAddress: mailingLines(profile),
    situsAddress: target?.addressLines ?? [],
    businessDescription: profile?.businessDescription ?? null,
  };

  const signer: FormSigner = {
    name: actor ?? '',
    title: profile?.signerTitle ?? null,
    capacity: options.filedByAgent ? 'agent' : 'owner',
    agentAppointmentDate: profile?.agentAppointmentDate ?? null,
  };

  // What the pure builders cannot see, because it is a fact about the database
  // rather than about the register.
  const extra = situsOmissions(target, owed);
  if (!actor) {
    extra.push({
      field: 'Signature',
      missing: 'Nobody is signed in, so there is no name to sign this.',
      severity: 'blocking',
    });
  }

  return {
    rendition,
    assetIds,
    party,
    signer,
    extra,
    actor,
    target,
    owed,
    clientId: client.id,
    clientName: client.name,
    taxYear: engagement.taxYear,
  };
}

export async function buildEngagementForm(
  engagementId: string,
  options: RenditionOptions & { audience: FormAudience },
): Promise<EngagementForm> {
  const { rendition, party, signer, extra, target, owed, clientName, taxYear } = await formInputs(
    engagementId,
    options,
  );
  const form = buildForm50144({ rendition, party, signer, audience: options.audience });
  form.omissions.push(...extra);
  const plan = planFormFill({ rendition, party, signer });
  return {
    form,
    clientName,
    taxYear,
    target,
    owed,
    printed: { revision: plan.revision, blocked: plan.blocked, overflow: plan.overflow },
  };
}

export interface EngagementFormPdf {
  bytes: Uint8Array;
  plan: FormFillPlan;
  /** What the browser should call the download. */
  filename: string;
}

/**
 * The same rendition, written onto the Comptroller's own PDF.
 *
 * Deliberately built from `formInputs` rather than from the `Form50144` the
 * screen renders: the screen's model is formatted for a person to read, and
 * parsing "$402,600" back into a number to put it in a box would be a silly way
 * to lose a digit. Two renderings of one source, neither derived from the other.
 */
export async function buildEngagementFormPdf(
  engagementId: string,
  options: RenditionOptions,
): Promise<EngagementFormPdf> {
  const { rendition, party, signer, extra, target, owed, clientName } = await formInputs(
    engagementId,
    options,
  );
  const plan = planFormFill({ rendition, party, signer });
  const bytes = await renderForm50144(plan);
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  // Two returns for one client in one year would otherwise download as the same
  // filename twice, and the second would be filed as a copy of the first.
  const site = owed.returns.length > 1 && target ? `-${slug(target.label)}` : '';
  return {
    bytes,
    plan: { ...plan, omissions: [...plan.omissions, ...extra] },
    filename: `50-144-${slug(clientName)}${site}-${rendition.taxYear}.pdf`,
  };
}

/**
 * What is still unsettled about where this property stood.
 *
 * Three separate failures, and they are worth keeping apart because the fix for
 * each is different. Nothing placed at all is a register nobody has read the
 * situs off yet. Several returns owed and none picked is a question to the
 * operator, not a defect. Property placed nowhere while other property is
 * placed somewhere is the dangerous one: it is under-rendering, which is what
 * Tax Code 22.28 penalises, and it hides behind a form that otherwise looks
 * complete.
 *
 * Stated once here and then handed to both screens. The draft lists blockers
 * and the form lists omissions — different words for the same page of the same
 * filing, and the one thing worse than saying this twice would be saying it
 * twice differently.
 */
function situsProblems(target: EngagementReturn | null, owed: EngagementReturns): FilingBlocker[] {
  const problems: FilingBlocker[] = [];

  if (owed.returns.length === 0) {
    problems.push({
      key: 'situs-none',
      severity: 'blocking',
      message:
        'No property on this engagement has a resolved location, so there is no situs to file it at.',
      resolution: 'Place the register’s locations against sites on the engagement.',
    });
    return problems;
  }

  if (!target) {
    problems.push({
      key: 'situs-unchosen',
      severity: 'blocking',
      message: `This engagement is ${owed.returns.length} returns, one per site (${owed.returns
        .map((r) => r.label)
        .join(
          ', ',
        )}), and this is the register whole rather than any one of them. Property is taxed where it stood on January 1 and the district opens an account per location, so a single form covering both would put one site’s property in the other’s taxing units.`,
      resolution: 'Pick the site this form is for.',
    });
    return problems;
  }

  if (owed.unplacedCount > 0) {
    const many = owed.returns.length > 1;
    const n = owed.unplacedCount;
    problems.push({
      key: 'situs-unplaced',
      severity: many ? 'blocking' : 'warning',
      message: many
        ? `${n} held ${n === 1 ? 'asset is' : 'assets are'} at no resolved site, so ${n === 1 ? 'it is' : 'they are'} on none of this engagement’s ${owed.returns.length} returns. Property left off every rendition is under-rendered, whichever site it turns out to sit at.`
        : `${n} held ${n === 1 ? 'asset has' : 'assets have'} no resolved location. ${n === 1 ? 'It is' : 'They are'} filed at ${target.label} because it is the only site this engagement has, which is right only if that is where ${n === 1 ? 'it' : 'they'} actually ${n === 1 ? 'is' : 'are'}.`,
      resolution: many
        ? 'Place them on the sites card, so each one lands on the return for the site it sits at.'
        : `Confirm they belong at ${target.label}, or record the site they are actually at.`,
    });
  }

  if (target.addressLines.length === 0) {
    problems.push({
      key: 'situs-address',
      severity: 'blocking',
      message: `${target.label} has no address recorded, and the form asks for the physical address the property is at — a label the client uses internally is not one.`,
      resolution: 'Add the street address to the site on the client page.',
    });
  }

  return problems;
}

/** The situs problems as the printed form words them. */
function situsOmissions(target: EngagementReturn | null, owed: EngagementReturns): FormOmission[] {
  return situsProblems(target, owed).map((problem) => ({
    field: 'Situs address',
    missing: `${problem.message} ${problem.resolution}`,
    severity: problem.severity,
  }));
}
