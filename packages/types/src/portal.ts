import { z } from 'zod';

/**
 * Who a signed-in person is, and therefore what they may see.
 *
 * The app has two audiences and one login. The firm works every client; a
 * business works only itself. Until now that distinction did not exist — one
 * allowlist admitted the firm, and the client wing asked the reader to pick a
 * business out of a dropdown. This is the type that replaces the dropdown.
 *
 * The two roles are not a hierarchy with the firm at the top. A firm viewer is
 * not a super-user of the portal, and a client admin is not a junior preparer:
 * they are different products that happen to share a deployment, and the gate
 * treats them as different products.
 */

export const VIEWER_AUDIENCES = ['firm', 'client'] as const;
export const ViewerAudienceSchema = z.enum(VIEWER_AUDIENCES);
export type ViewerAudience = (typeof VIEWER_AUDIENCES)[number];

/**
 * What a client-side person may do, inside their own business.
 *
 * Deliberately two values and not a permission matrix. The only acts the portal
 * offers are reading the report, sending files, and answering a question — and
 * the meaningful split is between someone who may speak for the business and
 * someone who may only read what was said. A controller forwarding a report to
 * their CFO should be able to do so without handing over the ability to answer
 * a question that becomes a tax position.
 */
export const PORTAL_ROLES = [
  /** Reads the report, sends registers, answers the questions we ask. */
  'admin',
  /** Reads the report. Cannot upload, cannot answer. */
  'viewer',
] as const;
export const PortalRoleSchema = z.enum(PORTAL_ROLES);
export type PortalRole = (typeof PORTAL_ROLES)[number];

/**
 * The resolved identity behind a request, after the gate has admitted it.
 *
 * A firm viewer carries no `clientId` — not null-as-unknown, but null meaning
 * "every client", which is why the scope helpers branch on `audience` rather
 * than on whether the id is present. A client viewer always carries one; a
 * client row that resolved to no business is a misconfiguration and is refused
 * at the gate rather than defaulting to something.
 */
export const ViewerSchema = z.object({
  email: z.string(),
  audience: ViewerAudienceSchema,
  /** The business this person speaks for. Null for the firm. */
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  /** Null for the firm, which has no portal role. */
  role: PortalRoleSchema.nullable(),
});

export type Viewer = z.infer<typeof ViewerSchema>;

/** One person granted access to one business's portal. */
export const PortalUserSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  email: z.string(),
  role: PortalRoleSchema,
  /**
   * Null until the person has actually signed in. An access grant is written
   * against an email address before any account exists, so this is the record
   * that somebody claimed it — and which auth identity did.
   */
  claimedAt: z.string().datetime().nullable(),
  invitedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type PortalUser = z.infer<typeof PortalUserSchema>;

export const GrantPortalAccessSchema = z.object({
  email: z.string().trim().min(1, 'An email address is required.').email(),
  role: PortalRoleSchema.default('admin'),
});

export type GrantPortalAccessRequest = z.infer<typeof GrantPortalAccessSchema>;

export const UpdatePortalAccessSchema = z.object({ role: PortalRoleSchema });
export type UpdatePortalAccessRequest = z.infer<typeof UpdatePortalAccessSchema>;

/**
 * The client's own settings for their portal.
 *
 * One setting today, and it is the one the product doc asks for: the confidence
 * floor beneath which finding rows are not shown by default. It belongs to the
 * client rather than to a browser because it is a statement about how they want
 * to work — a controller who only wants to see positions their auditor would
 * not blink at should not have to re-say that on their phone, and a colleague
 * opening the same report should see the same report.
 *
 * A floor narrows a *view*. It never changes a total: the report still says
 * what the whole population is, and the filter bar still says what it is
 * hiding. A setting that quietly showed a smaller number than the truth would
 * be a worse product than no setting.
 */
export const PortalSettingsSchema = z.object({
  clientId: z.string(),
  confidenceFloor: z.enum(['high', 'medium', 'low']),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type PortalSettings = z.infer<typeof PortalSettingsSchema>;

export const UpdatePortalSettingsSchema = z.object({
  confidenceFloor: z.enum(['high', 'medium', 'low']),
});

export type UpdatePortalSettingsRequest = z.infer<typeof UpdatePortalSettingsSchema>;
