import { dr405Entry } from './documents/dr405.js';
import { invoiceEntry } from './documents/invoice.js';
import { noticeEntry } from './documents/notice-hcad.js';
import { priorRenditionEntry } from './documents/prior-rendition.js';
import { trimNoticeEntry } from './documents/trim-notice.js';
import { assetkeeperEntry } from './registers/assetkeeper.js';
import { bookkeeperEntry } from './registers/bookkeeper.js';
import { coastalWorksheetEntry } from './registers/coastal-worksheet.js';
import { dentalPivotEntry } from './registers/dental-pivot.js';
import { halcyonNbvEntry } from './registers/halcyon-nbv.js';
import { ironwoodAdditionsEntry } from './registers/ironwood-additions.js';
import { netsuiteEntry } from './registers/netsuite.js';
import { prosystemEntry } from './registers/prosystem.js';
import { sageDetailEntry } from './registers/sage-detail.js';
import { xeroEntry } from './registers/xero.js';
import type { CorpusEntry } from './types.js';

/**
 * The mail, in the order it is worth reading.
 *
 * Clean first, then the ordinary mess, then the files that should not get
 * through. That ordering is not cosmetic: a corpus read top to bottom should
 * make it obvious that the easy case is the common case, because a set of
 * nothing but disasters teaches a reader — human or otherwise — that suspicion
 * is always the right answer, and a product built on that suspicion never
 * finishes anything without a person.
 */
export const CORPUS: readonly CorpusEntry[] = [
  xeroEntry(),
  netsuiteEntry(),
  bookkeeperEntry(),
  prosystemEntry(),
  coastalWorksheetEntry(),
  ironwoodAdditionsEntry(),
  sageDetailEntry(),
  assetkeeperEntry(),
  halcyonNbvEntry(),
  dentalPivotEntry(),
  priorRenditionEntry(),
  dr405Entry(),
  noticeEntry(),
  trimNoticeEntry(),
  invoiceEntry(),
];

export function corpusEntry(id: string): CorpusEntry {
  const found = CORPUS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No corpus entry "${id}".`);
  return found;
}
