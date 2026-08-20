import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
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
import type { ClassificationStatus, Rendition, RenditionBasis } from '@tangible/types';
import { scheduleFor } from '@tangible/valuation';
import { currentActor } from '@/lib/actor';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { renditionPositions } from '@/lib/findings';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export interface RenditionOptions {
  basis: RenditionBasis;
  filedByAgent: boolean;
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
export async function buildEngagementRendition(
  engagementId: string,
  options: RenditionOptions,
): Promise<Rendition> {
  const { engagement, client } = await fetchEngagement(engagementId);
  const db = requireDb();
  // The decision log, read alongside the register. Empty until somebody has
  // committed a set, which is the normal state of a new engagement.
  const positions = await renditionPositions(engagementId);
  const rows = await db
    .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
    .from(schema.assetVersions)
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(engagementAssetsWhere(engagementId));

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

  return buildRendition({
    engagementId,
    clientName: client.name,
    taxYear: engagement.taxYear,
    jurisdictionId: engagement.jurisdictionId,
    accountId: engagement.accountId,
    sicCode: engagement.sicCode,
    assets,
    positions,
    schedule: engagement.jurisdictionId
      ? (scheduleFor(engagement.jurisdictionId, engagement.taxYear) ?? null)
      : null,
    basis: options.basis,
    filedByAgent: options.filedByAgent,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Where this engagement's property stood on January 1, read off the assets.
 *
 * Situs is a fact about the property, not about the engagement, which is why it
 * is resolved per asset (`assets.location_id`) rather than stored once on the
 * engagement. That has a consequence the form cannot paper over: a register
 * covering two sites is two renditions, because the situs decides which taxing
 * units get the property and the district assesses per location. So this
 * returns every location it finds and lets the caller refuse rather than
 * silently filing the first one.
 */
async function situsFor(engagementId: string) {
  const db = requireDb();
  const rows = await db
    .selectDistinct({ locationId: schema.assets.locationId })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    // Held property only. A disposed asset is not on the return, so where it
    // used to sit cannot decide where the return is filed — and an unplaced
    // one must not be able to block a form it does not appear on.
    .where(and(engagementAssetsWhere(engagementId), eq(schema.assetVersions.isDisposed, false)));

  const ids = rows.map((row) => row.locationId).filter((id): id is string => id !== null);
  if (ids.length === 0) return { locations: [], unresolved: rows.length > 0 };

  const locations = await db
    .select()
    .from(schema.clientLocations)
    .where(inArray(schema.clientLocations.id, ids));
  // A null location_id on any asset means the register named a site we have not
  // resolved yet — worth saying, because it might be a *different* site.
  return { locations, unresolved: rows.some((row) => row.locationId === null) };
}

const addressLines = (location: typeof schema.clientLocations.$inferSelect): string[] =>
  [
    location.addressLine1,
    [location.city, location.stateCode].filter(Boolean).join(', '),
    location.zip,
  ].filter((line): line is string => Boolean(line && line.trim()));

/**
 * The owner's mailing address, from the filing profile.
 *
 * Kept separate from {@link addressLines} on purpose even though the shape is
 * nearly the same. A situs is where property stood on January 1 and comes off a
 * location row; a mailing address is where the district sends the notice that
 * starts the 41.44 protest clock, and comes off the taxpayer. Collapsing them
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
async function formInputs(engagementId: string, options: RenditionOptions) {
  const { engagement, client } = await fetchEngagement(engagementId);
  const db = requireDb();
  const [rendition, situs, actor, profiles] = await Promise.all([
    buildEngagementRendition(engagementId, options),
    situsFor(engagementId),
    currentActor(),
    db
      .select()
      .from(schema.clientFilingProfiles)
      .where(eq(schema.clientFilingProfiles.clientId, client.id)),
  ]);

  const single = situs.locations.length === 1 ? situs.locations[0]! : null;
  const profile = profiles[0] ?? null;

  const party: FormParty = {
    // The roll name and the name we file the client under are usually the same
    // and legally need not be. Ours stands until somebody records that it does.
    ownerName: profile?.ownerName ?? client.name,
    mailingAddress: mailingLines(profile),
    situsAddress: single ? addressLines(single) : [],
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
  const extra = situsOmissions(situs, single !== null);
  if (!actor) {
    extra.push({
      field: 'Signature',
      missing: 'Nobody is signed in, so there is no name to sign this.',
      severity: 'blocking',
    });
  }

  return { rendition, party, signer, extra, clientName: client.name, taxYear: engagement.taxYear };
}

export async function buildEngagementForm(
  engagementId: string,
  options: RenditionOptions & { audience: FormAudience },
): Promise<EngagementForm> {
  const { rendition, party, signer, extra, clientName, taxYear } = await formInputs(
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
  const { rendition, party, signer, extra, clientName } = await formInputs(engagementId, options);
  const plan = planFormFill({ rendition, party, signer });
  const bytes = await renderForm50144(plan);
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    bytes,
    plan: { ...plan, omissions: [...plan.omissions, ...extra] },
    filename: `50-144-${slug}-${rendition.taxYear}.pdf`,
  };
}

function situsOmissions(
  situs: Awaited<ReturnType<typeof situsFor>>,
  resolved: boolean,
): FormOmission[] {
  const omissions: FormOmission[] = [];
  if (situs.locations.length > 1) {
    omissions.push({
      field: 'Situs address',
      missing: `This engagement's property sits at ${situs.locations.length} locations (${situs.locations
        .map((location) => location.label)
        .join(
          ', ',
        )}). Property is taxed where it stood on January 1, so this is that many renditions, not one form with several addresses.`,
      severity: 'blocking',
    });
  }
  if (situs.unresolved) {
    omissions.push({
      field: 'Situs address',
      missing: resolved
        ? 'Some assets have no resolved location. They are being filed at the one site we do know about, which is only right if that is where they actually are.'
        : 'No asset on this engagement has a resolved location.',
      severity: resolved ? 'warning' : 'blocking',
    });
  }
  return omissions;
}
