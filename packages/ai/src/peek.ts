import { DocumentPeekSchema, type DocumentPeek } from '@tangible/types';
import { parseStructured, type StructuredDocument, type StructuredResult } from './structured.js';

/**
 * Read what a document says about itself, and nothing more.
 *
 * Deliberately not extraction and not triage. Extraction reads a document the
 * pipeline already knows the kind of; triage decides kinds over a whole batch.
 * The peek sits between them: one cheap look per scan, reporting only what is
 * printed — the title, a form number, an account, a year — so that triage
 * judges a PDF by its first page instead of its filename. Anything the peek
 * gets wrong is caught where everything else is: the routed pipeline's own
 * extraction, and the person confirming the route.
 */

const SYSTEM = `You take a first look at a document for a business personal property tax practice and report what it says about itself.

Report only what is printed on the document: its title or heading, a form number if one appears (Texas renditions print "50-144"), who issued or filed it, the account number and tax year if stated. The one-sentence summary says what kind of document this is in plain words ("A Harris County appraisal district notice of appraised value for account 1234567").

Do not infer, estimate, or fill in from context. A field you cannot read is null.`;

const PEEK_MAX_TOKENS = 1_000;

export async function peekDocument(
  document: StructuredDocument,
): Promise<StructuredResult<DocumentPeek>> {
  return parseStructured({
    system: SYSTEM,
    user: 'Take a first look at this document and report what it says about itself.',
    schema: DocumentPeekSchema,
    schemaName: 'document_peek',
    maxTokens: PEEK_MAX_TOKENS,
    task: 'extraction',
    document,
  });
}
