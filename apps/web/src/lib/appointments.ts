import 'server-only';
import { asc, desc, eq } from 'drizzle-orm';
import type { AgentAppointmentRow, FilingAgentRow } from '@tangible/db';
import {
  appointmentStanding,
  appraisalDistrictName,
  nearestAppointment,
  planAppointmentFill,
  renderForm50162,
  type AppointmentQuery,
} from '@tangible/filing';
import type {
  AgentAppointment,
  AppointmentDelivery,
  AppointmentMatters,
  AppointmentScope,
  AppointmentSignerCapacity,
  FilingAgent,
  RecordAppointmentRequest,
  UpdateAppointmentRequest,
  UpdateFilingAgentRequest,
} from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { HttpError, notFound } from '@/lib/route';
import { today } from '@/lib/today';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Storing who we are as agent, and every Form 50-162 a client has signed.
 *
 * Two tables with very different shapes and one reason. The agent record is a
 * single row for the firm: our name and address are the same on every form, and
 * copying them onto each appointment is how half of them end up stale after an
 * office move. The appointments are a log — one row per signed form, never
 * edited except to record the two things that happen to it afterwards, being
 * filed and being revoked.
 *
 * Whether any of them authorises a particular filing is decided in
 * `@tangible/filing`, against the date being asked about. That is deliberately
 * not stored: an appointment's standing changes with the calendar without
 * anybody touching the row.
 */

/** The single agent row, created empty on first read so callers never see null. */
const AGENT_ID = 'agent';

export async function filingAgent(): Promise<FilingAgent> {
  const rows = await requireDb()
    .select()
    .from(schema.filingAgent)
    .where(eq(schema.filingAgent.id, AGENT_ID));
  return toAgent(rows[0] ?? null);
}

export async function updateFilingAgent(body: UpdateFilingAgentRequest): Promise<FilingAgent> {
  const db = requireDb();
  // A patch of one field leaves the rest alone, so `undefined` and `null` mean
  // different things here: not mentioned, versus cleared.
  const patch = {
    ...(body.name !== undefined ? { name: body.name || null } : {}),
    ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
    ...(body.addressLine1 !== undefined ? { addressLine1: body.addressLine1 || null } : {}),
    ...(body.city !== undefined ? { city: body.city || null } : {}),
    ...(body.stateCode !== undefined ? { stateCode: body.stateCode?.toUpperCase() || null } : {}),
    ...(body.zip !== undefined ? { zip: body.zip || null } : {}),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(schema.filingAgent)
    .values({ id: AGENT_ID, ...patch })
    .onConflictDoUpdate({ target: schema.filingAgent.id, set: patch })
    .returning();
  if (!row) throw new HttpError(500, 'The agent record was not saved.');
  return toAgent(row);
}

/**
 * Every appointment on file for a client, newest signature first.
 *
 * Standing is computed against today, which is the question the client page is
 * asking. A rendition asks a different one — whether we were appointed on the
 * day it goes out — and calls {@link appointmentAt} for it.
 */
export async function clientAppointments(clientId: string): Promise<AgentAppointment[]> {
  const rows = await requireDb()
    .select()
    .from(schema.agentAppointments)
    .where(eq(schema.agentAppointments.clientId, clientId))
    .orderBy(desc(schema.agentAppointments.signedOn), desc(schema.agentAppointments.createdAt));
  const asOf = today();
  return rows.map((row) => toAppointment(row, asOf));
}

/**
 * The appointment a filing for one site would be made under, standing or not.
 *
 * Returns the closest thing we hold rather than only a live one, because the
 * blocker it feeds has to distinguish "never asked for" from "signed and still
 * unfiled" — same gate, entirely different morning's work.
 */
export async function appointmentAt(
  clientId: string,
  query: AppointmentQuery,
): Promise<AgentAppointment | null> {
  const appointments = await clientAppointments(clientId);
  const found = nearestAppointment(appointments, query);
  if (!found) return null;
  // Re-derive against the filing date rather than today: the row the client
  // page shows as expired may be exactly the one that was in force in April.
  return { ...found, ...appointmentStanding(found, query.on) };
}

export async function recordAppointment(
  clientId: string,
  body: RecordAppointmentRequest,
): Promise<AgentAppointment> {
  const db = requireDb();
  const actor = await currentActor();
  const [row] = await db
    .insert(schema.agentAppointments)
    .values({
      clientId,
      jurisdictionId: body.jurisdictionId,
      scope: body.scope,
      locationIds: body.scope === 'all-at-address' ? [] : body.locationIds,
      matters: body.matters,
      specificMatters: body.specificMatters,
      receivesConfidential: body.receivesConfidential,
      deliveries: body.deliveries,
      signedOn: body.signedOn,
      filedOn: body.filedOn,
      endsOn: body.endsOn,
      signerName: body.signerName,
      signerTitle: body.signerTitle,
      signerCapacity: body.signerCapacity,
      note: body.note,
      recordedBy: actor,
    })
    .returning();
  if (!row) throw new HttpError(500, 'The appointment was not recorded.');
  return toAppointment(row, today());
}

/**
 * Record that it reached the district, or that it has been revoked.
 *
 * The only two edits an appointment ever takes, and both are additions rather
 * than corrections: a filed date the row did not have, and an end to it. A form
 * signed with the wrong terms is not patched here — it is a new form, which is
 * what the district would need anyway.
 */
export async function updateAppointment(
  appointmentId: string,
  body: UpdateAppointmentRequest,
): Promise<AgentAppointment> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(schema.agentAppointments)
    .where(eq(schema.agentAppointments.id, appointmentId));
  const existing = rows[0];
  if (!existing) notFound('No appointment with that id.');

  const patch: Partial<AgentAppointmentRow> = {};
  if (body.filedOn !== undefined && body.filedOn !== null) {
    if (existing.filedOn) {
      throw new HttpError(
        409,
        `That appointment is already on file with the district as of ${existing.filedOn}.`,
      );
    }
    if (body.filedOn < existing.signedOn) {
      throw new HttpError(409, 'An appointment cannot reach the district before it is signed.');
    }
    patch.filedOn = body.filedOn;
  }
  if (body.revokedOn !== undefined && body.revokedOn !== null) {
    if (body.revokedOn < existing.signedOn) {
      throw new HttpError(409, 'An appointment cannot be revoked before it is signed.');
    }
    patch.revokedOn = body.revokedOn;
    patch.revokedReason = body.revokedReason ?? null;
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change.');

  const [row] = await db
    .update(schema.agentAppointments)
    .set(patch)
    .where(eq(schema.agentAppointments.id, appointmentId))
    .returning();
  if (!row) throw new HttpError(500, 'The appointment was not updated.');
  return toAppointment(row, today());
}

/** One appointment with everything the form needs, for the PDF route. */
export async function appointmentById(appointmentId: string): Promise<AgentAppointment> {
  const rows = await requireDb()
    .select()
    .from(schema.agentAppointments)
    .where(eq(schema.agentAppointments.id, appointmentId))
    .orderBy(asc(schema.agentAppointments.createdAt));
  const row = rows[0];
  if (!row) notFound('No appointment with that id.');
  return toAppointment(row, today());
}

function toAgent(row: FilingAgentRow | null): FilingAgent {
  return {
    name: row?.name ?? null,
    phone: row?.phone ?? null,
    addressLine1: row?.addressLine1 ?? null,
    city: row?.city ?? null,
    stateCode: row?.stateCode ?? null,
    zip: row?.zip ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

function toAppointment(row: AgentAppointmentRow, on: string): AgentAppointment {
  const base = {
    id: row.id,
    clientId: row.clientId,
    jurisdictionId: row.jurisdictionId,
    scope: row.scope as AppointmentScope,
    locationIds: row.locationIds ?? [],
    matters: row.matters as AppointmentMatters,
    specificMatters: row.specificMatters,
    receivesConfidential: row.receivesConfidential,
    deliveries: (row.deliveries ?? []) as AppointmentDelivery[],
    signedOn: row.signedOn,
    filedOn: row.filedOn,
    endsOn: row.endsOn,
    revokedOn: row.revokedOn,
    revokedReason: row.revokedReason,
    signerName: row.signerName,
    signerTitle: row.signerTitle,
    signerCapacity: row.signerCapacity as AppointmentSignerCapacity,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
  return { ...base, ...appointmentStanding(base, on) };
}

/**
 * The client's Form 50-162, filled from what we hold.
 *
 * Assembled here rather than in the package because half of it is database:
 * the owner's identity comes off the filing profile, the property rows off the
 * client's own sites, and Step 3 off the single agent record. What goes in
 * which box, and what refuses to print, is `planAppointmentFill`'s job.
 */
export async function buildAppointmentPdf(
  appointmentId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const appointment = await appointmentById(appointmentId);
  const db = requireDb();
  const [agent, profiles, clients, locations] = await Promise.all([
    filingAgent(),
    db
      .select()
      .from(schema.clientFilingProfiles)
      .where(eq(schema.clientFilingProfiles.clientId, appointment.clientId)),
    db.select().from(schema.clients).where(eq(schema.clients.id, appointment.clientId)),
    db
      .select()
      .from(schema.clientLocations)
      .where(eq(schema.clientLocations.clientId, appointment.clientId))
      .orderBy(asc(schema.clientLocations.label)),
  ]);
  const profile = profiles[0] ?? null;
  const client = clients[0];
  if (!client) notFound('No client for that appointment.');

  // The order the form lists them in is the order the appointment named them,
  // so a form reprinted after a site was renamed still reads the same way.
  const byId = new Map(locations.map((row) => [row.id, row]));
  const named =
    appointment.scope === 'all-at-address'
      ? []
      : appointment.locationIds.map((id) => byId.get(id)).filter((row) => row !== undefined);

  const plan = planAppointmentFill({
    districtName: appraisalDistrictName(appointment.jurisdictionId),
    owner: {
      // The roll name and our client name are usually the same and need not be.
      name: profile?.ownerName ?? client.name,
      phone: null,
      street:
        [profile?.mailingAddressLine1, profile?.mailingAddressLine2]
          .filter((line) => Boolean(line?.trim()))
          .join(', ') || null,
      cityStateZip: cityStateZip(
        profile?.mailingCity,
        profile?.mailingStateCode,
        profile?.mailingZip,
      ),
    },
    agent: {
      name: agent.name ?? '',
      phone: agent.phone,
      street: agent.addressLine1,
      cityStateZip: cityStateZip(agent.city, agent.stateCode, agent.zip),
    },
    terms: {
      scope: appointment.scope,
      matters: appointment.matters,
      specificMatters: appointment.specificMatters,
      receivesConfidential: appointment.receivesConfidential,
      deliveries: appointment.deliveries,
      endsOn: appointment.endsOn,
      signedOn: appointment.signedOn,
      signerName: appointment.signerName,
      signerTitle: appointment.signerTitle,
      signerCapacity: appointment.signerCapacity,
    },
    properties: named.map((row) => ({
      label: row.label,
      accountId: row.accountId,
      situsAddress:
        [row.addressLine1, cityStateZip(row.city, row.stateCode, row.zip)]
          .filter(Boolean)
          .join(', ') || null,
      legalDescription: null,
    })),
  });

  const bytes = await renderForm50162(plan);
  const slug = client.name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return { bytes, filename: `50-162-${slug || 'client'}-${appointment.signedOn}.pdf` };
}

const cityStateZip = (
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): string | null => {
  const left = [city, state].filter((part) => Boolean(part?.trim())).join(', ');
  return [left, zip?.trim()].filter(Boolean).join(' ') || null;
};
