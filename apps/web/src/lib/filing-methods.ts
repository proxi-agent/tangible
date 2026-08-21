import type { FilingMethod } from '@tangible/types';

/**
 * How a document reached the district, as an operator names it.
 *
 * Shared between the filing record and the extension record because they are
 * the same act — something left the office on a date, and Tax Code 1.08 decides
 * timeliness from the postmark either way. Two lists would drift, and a history
 * where the return says "Certified mail" and the extension request beside it
 * says "certified-mail" reads as two systems rather than one file.
 */
export const METHOD_LABEL: Record<FilingMethod, string> = {
  'certified-mail': 'Certified mail',
  mail: 'Regular mail',
  efile: 'E-filed',
  email: 'Email',
  'hand-delivered': 'Hand delivered',
};
