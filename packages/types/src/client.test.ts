import { describe, expect, it } from 'vitest';
import {
  PlaceSiteRequestSchema,
  UpdateFilingProfileRequestSchema,
  UpdateLocationRequestSchema,
} from './client.js';

const filled = {
  ownerName: 'Acme Manufacturing LLC',
  mailingAddressLine1: '1200 Commerce St',
  mailingAddressLine2: 'Suite 400',
  mailingCity: 'Houston',
  mailingStateCode: 'TX',
  mailingZip: '77002',
  businessDescription: 'Machine shop, precision parts',
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

  it('wants every box present, so a save clears what the screen cleared', () => {
    // A PUT of the whole shape, not a patch of the keys that happen to be set:
    // omitting a key would silently mean "leave it alone", and then a wrong
    // address the user just deleted would still be on the next rendition.
    const { mailingZip, ...missingOne } = filled;
    expect(() => UpdateFilingProfileRequestSchema.parse(missingOne)).toThrow();
    expect(parse({ mailingZip: null }).mailingZip).toBeNull();
  });
});

describe('editing a location after the fact', () => {
  it('takes one field on its own, because that is how a row gets edited', () => {
    // PATCH semantics matter here: sending {city} must not be read as an
    // instruction to blank the street and the ZIP that were already right.
    expect(UpdateLocationRequestSchema.parse({ city: 'Houston' })).toEqual({ city: 'Houston' });
    expect(UpdateLocationRequestSchema.parse({})).toEqual({});
  });

  it('separates a box left alone from a box emptied on purpose', () => {
    // Absent is "I did not touch this". Empty is "there is no answer" — and on
    // a situs, the difference is whether the form prints a stale address.
    const cleared = UpdateLocationRequestSchema.parse({ addressLine1: '', zip: '  ' });
    expect(cleared.addressLine1).toBeNull();
    expect(cleared.zip).toBeNull();
    expect('city' in cleared).toBe(false);
  });

  it('normalises the state the district prints, and lets it be cleared', () => {
    expect(UpdateLocationRequestSchema.parse({ stateCode: 'tx' }).stateCode).toBe('TX');
    expect(UpdateLocationRequestSchema.parse({ stateCode: '' }).stateCode).toBeNull();
    expect(() => UpdateLocationRequestSchema.parse({ stateCode: 'Texas' })).toThrow();
  });

  it('will not let a location lose the name people know it by', () => {
    // Every other field can go empty; the label is what an operator picks from
    // when placing a register's rows, so a blank one is not an edit.
    expect(() => UpdateLocationRequestSchema.parse({ label: '   ' })).toThrow();
  });
});

describe("placing a register's rows at a site", () => {
  it("carries the register's own words as the target", () => {
    expect(PlaceSiteRequestSchema.parse({ text: 'Houston Plant', locationId: 'loc_1' })).toEqual({
      text: 'Houston Plant',
      locationId: 'loc_1',
    });
  });

  it('treats "the register named no site" as a group, not a missing field', () => {
    // Rows with a blank location cell are real property that has to be placed
    // somewhere. Null is the address of that group, not an omission.
    expect(PlaceSiteRequestSchema.parse({ text: null, locationId: 'loc_1' }).text).toBeNull();
    expect(() => PlaceSiteRequestSchema.parse({ locationId: 'loc_1' })).toThrow();
  });

  it('refuses a placement with nowhere to place it', () => {
    expect(() => PlaceSiteRequestSchema.parse({ text: 'Plant', locationId: '' })).toThrow();
  });
});
