import { z } from 'zod';

/**
 * Agent appointment: Form 50-162, and who is allowed to sign a rendition.
 *
 * Everything else in this pipeline assumes we may act for the client. This is
 * the document that makes that true, and it is worth modelling properly rather
 * than as the single date it used to be, because Tax Code 1.111 and the form's
 * own instructions turn on distinctions a date cannot carry:
 *
 *   - **Signed is not effective.** The form says a designation "will not take
 *     effect until filed with the appropriate appraisal district". A signed
 *     50-162 in our drawer authorises nothing.
 *   - **It is per appraisal district.** The district's name is field one, and
 *     districts keep their own agent records — one filed with Harris is
 *     invisible to Fort Bend. A client with sites in two counties needs two.
 *   - **It ends three ways.** By the expiration date on the form, by a written
 *     revocation filed with the district (1.111(c)), or silently: under
 *     1.111(d) an owner may not have two agents for one item of property, so
 *     appointing somebody else revokes ours for that property without anyone
 *     telling us.
 *   - **Confidentiality is a separate box.** 22.27 makes rendition contents
 *     confidential and Step 4's radio is what lets the district disclose them
 *     to us. An appointment that says No is valid and still leaves us unable
 *     to receive the client's own filing back.
 */

/** How Step 2 identifies the property the authority covers. */
export const APPOINTMENT_SCOPES = [
  /**
   * "All property listed for me at the above address" — the owner's own
   * mailing address from Step 1.
   *
   * Convenient and, for business personal property, usually the wrong box: the
   * property sits at each site, and a client whose notices go to a downtown
   * office has no property listed at that address at all. Recorded because
   * clients do sign it, and then somebody has to know what it did and did not
   * reach.
   */
  'all-at-address',
  /** The accounts listed on the form. What a multi-situs BPP client wants. */
  'listed',
] as const;

export const AppointmentScopeSchema = z.enum(APPOINTMENT_SCOPES);
export type AppointmentScope = (typeof APPOINTMENT_SCOPES)[number];

/** Step 4's check-one: how wide the agent's authority runs. */
export const APPOINTMENT_MATTERS = ['all', 'specific'] as const;
export const AppointmentMattersSchema = z.enum(APPOINTMENT_MATTERS);
export type AppointmentMatters = (typeof APPOINTMENT_MATTERS)[number];

/**
 * Which offices send their paper to us instead of the client.
 *
 * Step 4's three boxes are a redirection, not a copy: the form has the owner
 * acknowledge that the documents "will not be delivered to me unless the
 * affected offices choose to send me copies". Worth naming individually,
 * because the ARB box is the one that decides whether a protest notice reaches
 * us in time to answer it.
 */
export const APPOINTMENT_DELIVERIES = ['chief-appraiser', 'arb', 'taxing-units'] as const;
export const AppointmentDeliverySchema = z.enum(APPOINTMENT_DELIVERIES);
export type AppointmentDelivery = (typeof APPOINTMENT_DELIVERIES)[number];

/** Step 6: who signed, in the form's own three categories. */
export const APPOINTMENT_SIGNER_CAPACITIES = [
  'owner',
  'property-manager',
  'other-authorized',
] as const;
export const AppointmentSignerCapacitySchema = z.enum(APPOINTMENT_SIGNER_CAPACITIES);
export type AppointmentSignerCapacity = (typeof APPOINTMENT_SIGNER_CAPACITIES)[number];

/**
 * Us, as the form names us.
 *
 * One row for the firm rather than a column on each appointment. The agent's
 * address is not incidental: Step 4 has the owner direct the district to
 * deliver documents "only to the agent at the agent's address indicated
 * above", so a stale address here is a protest notice that goes nowhere.
 */
export const FilingAgentSchema = z.object({
  /** The firm as it should appear on Step 3. */
  name: z.string().nullable(),
  phone: z.string().nullable(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  zip: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
});

export type FilingAgent = z.infer<typeof FilingAgentSchema>;

const isoDate = (message = 'Expected a YYYY-MM-DD date.') =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);

/**
 * One appointment, as signed and as filed.
 *
 * `locationIds` is the set of this client's sites the form lists, and it is
 * meaningful only under the `listed` scope. Storing site ids rather than
 * account numbers is deliberate: the account is a fact about the site that can
 * arrive, change, or be corrected later, and an appointment that stopped
 * covering a site because somebody fixed a typo in its account number would be
 * a bad surprise.
 */
export const AgentAppointmentSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  /** The appraisal district it was filed with. Authority stops at its line. */
  jurisdictionId: z.string(),

  scope: AppointmentScopeSchema,
  /** Sites named on the form. Empty under `all-at-address`. */
  locationIds: z.array(z.string()),
  matters: AppointmentMattersSchema,
  /** What Step 4 says, where the authority is limited. */
  specificMatters: z.string().nullable(),
  /** Step 4's 22.27(b)(2) radio. False means the district may not send us the file. */
  receivesConfidential: z.boolean(),
  deliveries: z.array(AppointmentDeliverySchema),

  /** ISO date the owner signed Step 6. */
  signedOn: z.string(),
  /** ISO date it reached the district. Null means it authorises nothing yet. */
  filedOn: z.string().nullable(),
  /** Step 5's expiry, where one was given. Null runs until revoked. */
  endsOn: z.string().nullable(),

  /** ISO date a written revocation was filed, and by whom or why. */
  revokedOn: z.string().nullable(),
  revokedReason: z.string().nullable(),

  signerName: z.string(),
  signerTitle: z.string().nullable(),
  signerCapacity: AppointmentSignerCapacitySchema,
  note: z.string().nullable(),
  createdAt: z.string().datetime(),

  /**
   * Whether this appointment authorises anything today.
   *
   * Derived on read for the same reason an extension's standing is: it is a
   * statement about a filing date, an expiry and a revocation that move
   * independently, and the interesting cases are the ones where the answer is
   * no. A signed-but-unfiled appointment looks exactly like a live one until
   * something says otherwise.
   */
  effective: z.boolean(),
  /** Why it does or does not stand, in one sentence a person can act on. */
  standing: z.string(),
});

export type AgentAppointment = z.infer<typeof AgentAppointmentSchema>;

export const RecordAppointmentRequestSchema = z
  .object({
    jurisdictionId: z.string().min(1, 'Choose the appraisal district this was filed with.'),
    scope: AppointmentScopeSchema.default('listed'),
    locationIds: z.array(z.string()).default([]),
    matters: AppointmentMattersSchema.default('all'),
    specificMatters: z.string().trim().nullish().transform((v) => v || null),
    receivesConfidential: z.boolean().default(true),
    deliveries: z
      .array(AppointmentDeliverySchema)
      .default(['chief-appraiser', 'arb', 'taxing-units']),
    signedOn: isoDate(),
    filedOn: isoDate().nullish().transform((v) => v ?? null),
    endsOn: isoDate().nullish().transform((v) => v ?? null),
    signerName: z.string().trim().min(1, 'The form has to name who signed it.'),
    signerTitle: z.string().trim().nullish().transform((v) => v || null),
    signerCapacity: AppointmentSignerCapacitySchema.default('owner'),
    note: z.string().trim().nullish().transform((v) => v || null),
  })
  .superRefine((value, ctx) => {
    // Step 2 is a check-one, and the second box is only an answer if it names
    // something. A `listed` appointment with no sites is a form granting
    // authority over nothing at all.
    if (value.scope === 'listed' && value.locationIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['locationIds'],
        message: 'Listing the properties means naming at least one site.',
      });
    }
    if (value.matters === 'specific' && !value.specificMatters) {
      ctx.addIssue({
        code: 'custom',
        path: ['specificMatters'],
        message: 'Limiting the authority means writing down what it is limited to.',
      });
    }
    if (value.filedOn && value.filedOn < value.signedOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['filedOn'],
        message: 'An appointment cannot reach the district before it is signed.',
      });
    }
    if (value.endsOn && value.endsOn <= value.signedOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'An appointment that expires on or before the day it was signed grants nothing.',
      });
    }
  });

export type RecordAppointmentRequest = z.infer<typeof RecordAppointmentRequestSchema>;

/** Filing it with the district, or writing down that it has ended. */
export const UpdateAppointmentRequestSchema = z
  .object({
    filedOn: isoDate().nullish(),
    revokedOn: isoDate().nullish(),
    revokedReason: z.string().trim().nullish(),
  })
  .refine((v) => v.filedOn !== undefined || v.revokedOn !== undefined, {
    message: 'Nothing to change.',
  });

export type UpdateAppointmentRequest = z.infer<typeof UpdateAppointmentRequestSchema>;

export const UpdateFilingAgentRequestSchema = z.object({
  name: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  stateCode: z.string().trim().max(2).nullish(),
  zip: z.string().trim().max(20).nullish(),
});

export type UpdateFilingAgentRequest = z.infer<typeof UpdateFilingAgentRequestSchema>;
