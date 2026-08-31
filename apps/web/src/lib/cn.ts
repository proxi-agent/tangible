import { twMerge, type ClassNameValue } from 'tailwind-merge';

/**
 * Joins class names and resolves Tailwind conflicts, so the last utility named
 * wins rather than whichever one the stylesheet happens to order later.
 *
 * This used to hand its arguments to `clsx` first. It no longer does, because
 * `twMerge` already accepts everything the call sites pass — strings, nested
 * arrays, and the `condition && 'class'` idiom, whose falsy branches it drops
 * on its own. The only thing `clsx` added was object syntax (`{ active: true }`),
 * which nothing here used. A dependency that duplicates what the dependency
 * beside it already does is worth its weight only in the features you actually
 * call, and this one had none.
 */
export function cn(...inputs: ClassNameValue[]): string {
  return twMerge(inputs);
}
