/**
 * The memory key: what makes two asset descriptions "the same thing said twice".
 *
 * Registers write the same asset a hundred ways — "DELL LATITUDE 5420", "Dell
 * Latitude 5420 (Acct)", "dell latitude 7420 - laptop #A4B812". A reviewer who
 * settles one of those should never be asked about the others, on this
 * engagement or any later one, so descriptions are folded to a key and the key
 * is what memory is stored against.
 *
 * The folding is deliberately conservative, because the failure modes are not
 * symmetric. A fingerprint that is too loose applies one client's human decision
 * to a different client's different asset — silently, with money attached. A
 * fingerprint that is too tight just costs one model call. So this drops only
 * what cannot carry a classification:
 *
 *   - case and accents, which never distinguish two kinds of property
 *   - punctuation, which registers use as decoration
 *   - bare numbers, which are quantities, sizes, model years, and part numbers
 *   - serial-shaped tokens, which are unique by construction and would otherwise
 *     guarantee that memory never hits at all
 *
 * Token *order* is kept. Sorting would merge a few more near-duplicates, but it
 * also makes the key unreadable, and a key a person can read is a key a person
 * can audit when a memory hit turns out to be wrong.
 */

/** Long enough to be an identifier rather than a word. */
const SERIAL_MIN_LENGTH = 6;

function isPureDigits(token: string): boolean {
  return /^\d+$/.test(token);
}

/**
 * Serial numbers, VINs, and asset tags: long, and mixing letters with digits.
 * "F150" and "R22" stay — they are short, and they are what the asset *is*.
 */
function isSerialShaped(token: string): boolean {
  return token.length >= SERIAL_MIN_LENGTH && /\d/.test(token) && /[a-z]/.test(token);
}

/**
 * Fold a description into its memory key, or null when nothing classifiable
 * survives — a description of "12345" or "-" is not a thing anyone can decide
 * about, and storing it would create a key that collides with every other
 * meaningless row.
 */
export function fingerprint(description: string | null | undefined): string | null {
  if (!description) return null;

  const folded = description
    .normalize('NFKD')
    // Strip combining marks, so "Café" and "Cafe" are one asset, not two.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Ampersands are punctuation everywhere else in a register; here they are a word.
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ');

  const tokens = folded
    .split(' ')
    .filter((token) => token.length >= 2 && !isPureDigits(token) && !isSerialShaped(token));

  return tokens.length > 0 ? tokens.join(' ') : null;
}

/**
 * What the engine looks at to decide a class. The register's own category and GL
 * account matter as much as the description — "Rack" means something different
 * under "Computer Equipment" than under "Warehouse Fixtures" — but they do not
 * enter the fingerprint, because they are one client's vocabulary and memory has
 * to cross clients to be worth anything. The conflict rule in
 * `classification_memory` is what catches the cases where that bites.
 */
export interface ClassificationInput {
  description: string | null;
  registerCategory: string | null;
  glAccount: string | null;
  usefulLife: string | null;
}

/** Nothing to go on — the engine says so instead of guessing from a cost. */
export function hasSomethingToClassify(input: ClassificationInput): boolean {
  return Boolean(
    input.description?.trim() || input.registerCategory?.trim() || input.glAccount?.trim(),
  );
}

/**
 * Two assets with identical inputs get one model call, not two. Registers repeat
 * themselves relentlessly — 400 rows of "Office chair" is a normal Tuesday — and
 * asking the same question twice would be both slower and, if the answers ever
 * differed, wrong.
 */
export function dedupeKey(input: ClassificationInput): string {
  const normal = (value: string | null) => (value ?? '').trim().toLowerCase();
  return JSON.stringify([
    fingerprint(input.description) ?? normal(input.description),
    normal(input.registerCategory),
    normal(input.glAccount),
    normal(input.usefulLife),
  ]);
}
