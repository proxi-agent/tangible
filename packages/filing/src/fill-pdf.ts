import { readFile } from 'node:fs/promises';
import { PDFBool, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { FormFillChoice, FormFillText } from './fill-50-144.js';

/**
 * Write a fill plan onto a pinned Comptroller PDF.
 *
 * Five forms now share this: 50-144, 50-162, 50-132, 50-771 and 50-230. What
 * they share is not convenience but a rule — every field name is looked up in
 * the document rather than assumed, and a name the document does not have is an
 * exception naming it, not a box that silently stays empty on a page somebody
 * signs and files. That check is the only thing standing between a republished
 * form and a filing that looks complete and answers nothing, so it belongs in
 * one place where it cannot rot in four.
 *
 * Nothing here decides what to write. The planners do that, and they are pure.
 */

/**
 * One radio group whose options live on separate widgets.
 *
 * Form 50-771's ground selector is built this way: one field named "10", five
 * widgets, each with its own on-state, which is how a PDF spells a radio group
 * without saying so. pdf-lib reads it as a check box, and a check box's own
 * `check()` picks the *first* widget's on-state — which on that form means a
 * motion silently claiming a clerical error whichever ground was chosen. So the
 * widget is found by its appearance state and the value written directly, past
 * the validation that only knows about the first one.
 *
 * Returns false when no widget offers the option, which the caller reports as a
 * missing field like any other.
 */
function selectSharedCheckBox(field: unknown, option: string): boolean {
  const acro = (field as { acroField?: { dict: PDFDict; getWidgets: () => unknown[] } }).acroField;
  if (acro === undefined) return false;
  const widgets = acro.getWidgets() as {
    dict: PDFDict;
    setAppearanceState: (state: PDFName) => void;
  }[];
  let found = false;
  for (const widget of widgets) {
    const normal = widget.dict
      .lookup(PDFName.of('AP'), PDFDict)
      .lookup(PDFName.of('N'), PDFDict) as PDFDict;
    const match = normal.keys().find((key) => key.decodeText() === option);
    if (match === undefined) {
      // Every other widget in the group is turned off explicitly. A group with
      // two appearance states on is a form two districts read two ways.
      widget.setAppearanceState(PDFName.of('Off'));
      continue;
    }
    widget.setAppearanceState(match);
    acro.dict.set(PDFName.of('V'), match);
    found = true;
  }
  return found;
}

export interface PinnedFormFill {
  /** The pinned template, as a URL relative to the calling module. */
  template: URL;
  /** How to name the form in an error: "Form 50-771". */
  formLabel: string;
  revision: string;
  text: readonly FormFillText[];
  choices: readonly FormFillChoice[];
  /** What to tell somebody to do about drift, in this form's own terms. */
  driftHint: string;
}

export async function fillPinnedForm(fill: PinnedFormFill): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await readFile(fill.template));
  const form = pdf.getForm();
  const missing: string[] = [];

  for (const { field, value } of fill.text) {
    const target = form.getFieldMaybe(field);
    if (target === undefined || !('setText' in target)) {
      missing.push(field);
      continue;
    }
    (target as { setText: (t: string) => void }).setText(value);
  }

  for (const { field, option } of fill.choices) {
    const target = form.getFieldMaybe(field);
    if (target === undefined) {
      missing.push(field);
      continue;
    }
    if (option === null && 'check' in target) {
      (target as { check: () => void }).check();
    } else if (option !== null && 'select' in target) {
      (target as { select: (o: string) => void }).select(option);
    } else if (option !== null && selectSharedCheckBox(target, option)) {
      continue;
    } else {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${fill.formLabel} (${fill.revision}) has no field named ${missing
        .map((f) => JSON.stringify(f))
        .join(', ')}. The pinned PDF and the field map have drifted apart — ${fill.driftHint}`,
    );
  }

  // Some viewers cache a field's stored appearance and show a filled form as
  // blank. This asks them to redraw from the values instead.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  return pdf.save();
}
