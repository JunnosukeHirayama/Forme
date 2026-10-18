import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Definition, PageSize, Values } from './domain';
import { topLeftToPdf } from './domain';
import { HttpError } from './http';

let fontBytes: Promise<Buffer> | undefined;
const getFont = () =>
  (fontBytes ||= readFile(join(process.cwd(), 'assets/fonts/BIZUDPGothic-Regular.ttf')));

export async function inspectPdf(bytes: Uint8Array): Promise<PageSize[]> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw new HttpError(422, 'PDFを読み込めません。パスワードのないPDFを選んでください。');
  }
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > 50)
    throw new HttpError(422, 'PDFは1〜50ページにしてください');
  for (const page of pdf.getPages()) {
    const crop = page.getCropBox();
    const media = page.getMediaBox();
    if (
      page.getRotation().angle % 360 !== 0 ||
      crop.x !== 0 ||
      crop.y !== 0 ||
      media.x !== 0 ||
      media.y !== 0 ||
      crop.width !== media.width ||
      crop.height !== media.height
    ) {
      throw new HttpError(
        422,
        '回転・特殊なトリミングのあるPDFにはまだ対応していません。標準の向きでPDFに書き出してからアップロードしてください。',
      );
    }
    if (crop.width < 100 || crop.height < 100 || crop.width > 3000 || crop.height > 3000)
      throw new HttpError(422, 'このPDFのページサイズには対応していません');
  }
  return pdf.getPages().map((p) => p.getSize());
}

function fittingSize(
  value: string,
  width: number,
  height: number,
  font: PDFFont,
  multiline: boolean,
) {
  // Match the fixed font size in the appearance stream. Reject rather than silently clipping.
  for (let size = 11; size >= 7; size -= 0.5) {
    const availableWidth = Math.max(1, width - 8);
    const lines: string[] = [];
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(line + char, size) > availableWidth && line) {
          lines.push(line);
          line = char;
        } else line += char;
      }
      lines.push(line);
    }
    if (
      (!multiline && lines.length === 1 && size * 1.4 <= height - 4) ||
      (multiline && lines.length * size * 1.4 <= height - 4)
    )
      return size;
  }
  return null;
}

export async function filledPdf(source: Uint8Array, definition: Definition, values: Values) {
  const pdf = await PDFDocument.load(source);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await getFont(), { subset: false });
  const characterSet = new Set(font.getCharacterSet());
  const form = pdf.getForm();
  const errors: Record<string, string> = {};
  for (const field of definition.fields) {
    const page = pdf.getPage(field.page);
    const box = topLeftToPdf(field, page.getSize());
    const name = `forme.${field.id}`;
    if (field.type === 'checkbox') {
      const checkbox = form.createCheckBox(name);
      const side = Math.min(box.width, box.height, 16);
      checkbox.addToPage(page, {
        x: box.x + 3,
        y: box.y + (box.height - side) / 2,
        width: side,
        height: side,
        borderWidth: 0.75,
        borderColor: rgb(0.2, 0.3, 0.27),
        backgroundColor: rgb(1, 1, 1),
      });
      if (values[field.id] === true) checkbox.check();
    } else {
      const value = typeof values[field.id] === 'string' ? (values[field.id] as string) : '';
      if ([...value].some((char) => char !== '\n' && !characterSet.has(char.codePointAt(0)!))) {
        errors[field.id] =
          'PDFに表示できない文字が含まれています。絵文字や特殊文字をご確認ください';
        continue;
      }
      const size = fittingSize(value, box.width, box.height, font, field.type === 'textarea');
      if (size === null) {
        errors[field.id] = '入力欄に収まりません。文章を短くしてください';
        continue;
      }
      const text = form.createTextField(name);
      if (field.type === 'textarea') text.enableMultiline();
      text.setText(value);
      text.addToPage(page, {
        ...box,
        borderWidth: 0,
        borderColor: undefined,
        backgroundColor: undefined,
        textColor: rgb(0.08, 0.15, 0.12),
        font,
      });
      text.setFontSize(size);
      text.updateAppearances(font);
    }
  }
  if (Object.keys(errors).length)
    throw new HttpError(422, '入力欄に収まらない回答があります', errors);
  form.updateFieldAppearances(font);
  pdf.setProducer('Forme · pdf-lib');
  return pdf.save();
}
