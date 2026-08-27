/**
 * The shared look of a form control.
 *
 * One border, one radius, one focus treatment across every control on every
 * screen. A field at rest is a quiet outline; hovered it warms toward the
 * accent; focused it takes the ring. Nothing else moves — a control that
 * changes size on focus drags the row it sits in.
 *
 * These live apart from `controls.tsx` because `Select` is its own module now
 * and needs the same classes for its trigger. A control that only looked
 * roughly like the input beside it would be worse than either.
 */

export const FIELD_BASE =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-hairline-strong)] ' +
  'bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)] ' +
  'transition-[border-color,box-shadow] outline-none ' +
  'hover:border-[color-mix(in_oklab,var(--color-accent)_45%,var(--color-hairline-strong))] ' +
  'focus-visible:border-[var(--color-accent)] ' +
  'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] ' +
  'disabled:cursor-not-allowed disabled:bg-[var(--color-sunken)] disabled:text-[var(--color-ink-muted)]';

/**
 * Single-line controls are one row tall; a textarea sets its own height from
 * `rows`, so the height cannot live in the shared base.
 */
export const FIELD = `h-9 ${FIELD_BASE}`;

/**
 * The compact height, for a control that sits inline in a line of text.
 *
 * A select in the scope bar, or beside a card's own heading, is a control among
 * prose rather than a field in a form, and a full-height one crowds the row it
 * sits in. Four screens had each reached for `className="h-8 text-xs"` to say
 * so; it is one word now, and one place to change it.
 */
export const FIELD_SM = `h-8 ${FIELD_BASE} text-xs`;
