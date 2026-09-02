import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Enough of a typesetter to make a document look like a document.
 *
 * The client mail that is not a spreadsheet is paper: a rendition filed last
 * year, the district's notice, a Florida return, an invoice for a press. All of
 * it reaches the product the same way — as a PDF handed to a vision model,
 * which reads what is printed rather than what is tagged. So these are drawn,
 * not filled: text at coordinates, ruled lines, right-aligned money, the
 * occasional box. Nothing here carries structure a machine could cheat off,
 * which is the point. A number on one of these pages is legible for exactly the
 * reason a number on a scan is legible, and no more.
 */

export const LETTER: [number, number] = [612, 792];

export interface Style {
  size?: number;
  bold?: boolean;
  mono?: boolean;
  grey?: boolean;
}

export interface Pen {
  /** Write at the left margin and advance the cursor one line. */
  line(text?: string, style?: Style): void;
  /** Write at an absolute x on the current line, without advancing. */
  at(x: number, text: string, style?: Style): void;
  /** Write right-aligned to an absolute x — how every money column is set. */
  right(x: number, text: string, style?: Style): void;
  /** Move the cursor down by n lines. */
  gap(n?: number): void;
  rule(from?: number, to?: number): void;
  box(x: number, width: number, height: number): void;
  /** Start a fresh page, resetting the cursor to the top margin. */
  page(): void;
  save(): Promise<Uint8Array>;
}

const MARGIN = 54;
const LEADING = 13.5;

export async function paper(): Promise<Pen> {
  const doc = await PDFDocument.create();
  const fonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  let page: PDFPage = doc.addPage(LETTER);
  let y = LETTER[1] - MARGIN;

  const pick = (style: Style = {}): PDFFont =>
    style.mono === true ? fonts.mono : style.bold === true ? fonts.bold : fonts.body;
  const draw = (x: number, text: string, style: Style = {}): void => {
    page.drawText(text, {
      x,
      y,
      size: style.size ?? 9.5,
      font: pick(style),
      color: style.grey === true ? rgb(0.42, 0.42, 0.42) : rgb(0, 0, 0),
    });
  };

  return {
    line(text = '', style = {}) {
      if (text !== '') draw(MARGIN, text, style);
      y -= LEADING;
    },
    at(x, text, style = {}) {
      draw(x, text, style);
    },
    right(x, text, style = {}) {
      const size = style.size ?? 9.5;
      draw(x - pick(style).widthOfTextAtSize(text, size), text, style);
    },
    gap(n = 1) {
      y -= LEADING * n;
    },
    rule(from = MARGIN, to = LETTER[0] - MARGIN) {
      page.drawLine({
        start: { x: from, y: y + 9 },
        end: { x: to, y: y + 9 },
        thickness: 0.6,
        color: rgb(0.25, 0.25, 0.25),
      });
      y -= LEADING;
    },
    box(x, width, height) {
      page.drawRectangle({
        x,
        y: y + 9 - height,
        width,
        height,
        borderWidth: 0.6,
        borderColor: rgb(0.25, 0.25, 0.25),
      });
    },
    page() {
      page = doc.addPage(LETTER);
      y = LETTER[1] - MARGIN;
    },
    save: () => doc.save(),
  };
}
