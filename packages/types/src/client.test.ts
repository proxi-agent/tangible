import { describe, expect, it } from 'vitest';
import { UpdateFilingProfileRequestSchema } from './client.js';

const filled = {
  ownerName: 'Acme Manufacturing LLC',
  mailingAddressLine1: '1200 Commerce St',
  mailingAddressLine2: 'Suite 400',
  mailingCity: 'Houston',
  mailingStateCode: 'TX',
  mailingZip: '77002',
  businessDescription: 'Machine shop, precision parts',
  agentAppointmentDate: '2026-01-15',
  signerTitle: 'Agent',
};

const parse = (over: Record<string, unknown> = {}) =>
  UpdateFilingProfileRequestSchema.parse({ ...filled, ...over });

describe('the filing profile a client saves', () => {
  it('keeps a fully answered profile as it was typed', () => {
    expect(parse()).toEqual(filled);
  });

  it('reads a cleared box as unknown rather than as an empty answer', () => {
    // The form's omissions turn on this: an empty string is a mailing address
    // the form would print, and null is one it will refuse to print without.
    expect(parse({ mailingAddressLine1: '' }).mailingAddressLine1).toBeNull();
    expect(parse({ businessDescription: '   ' }).businessDescription).toBeNull();
  });

  it('lets a two-letter state code be cleared, not just replaced', () => {
    // Blanking runs before the length rule, so clearing the box is allowed
    // where '' would otherwise fail `.length(2)` and strand the whole form.
    expect(parse({ mailingStateCode: '' }).mailingStateCode).toBeNull();
    expect(parse({ mailingStateCode: 'tx' }).mailingStateCode).toBe('TX');
    expect(() => parse({ mailingStateCode: 'Texas' })).toThrow();
  });

  it('refuses an appointment date it cannot read back onto the form', () => {
    // 50-162's date is transcribed off a signed page and printed onto another.
    // 01/02/2026 is January in Houston and February in most of the world, and
    // this box ends up on a sworn document.
    expect(() => parse({ agentAppointmentDate: '15/01/2026' })).toThrow(/ISO date/);
    expect(() => parse({ agentAppointmentDate: 'January 15, 2026' })).toThrow(/ISO date/);
    expect(parse({ agentAppointmentDate: '' }).agentAppointmentDate).toBeNull();
  });

  it('wants every box present, so a save clears what the screen cleared', () => {
    // A PUT of the whole shape, not a patch of the keys that happen to be set:
    // omitting a key would silently mean "leave it alone", and then a wrong
    // address the user just deleted would still be on the next rendition.
    const { mailingZip, ...missingOne } = filled;
    expect(() => UpdateFilingProfileRequestSchema.parse(missingOne)).toThrow();
    expect(parse({ mailingZip: null }).mailingZip).toBeNull();
  });
});
