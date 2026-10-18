import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Definition, FieldType } from '../src/lib/domain';

async function main() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Embed complete Japanese fonts; subsetting these fonts can drop glyphs in PDF viewers.
  const mincho = await pdf.embedFont(await readFile('assets/fonts/BIZUDMincho-Regular.ttf'), {
    subset: false,
  });
  const gothic = await pdf.embedFont(await readFile('assets/fonts/BIZUDPGothic-Regular.ttf'), {
    subset: false,
  });
  const width = 595.28,
    height = 841.89;
  const page = pdf.addPage([width, height]);
  const ink = rgb(0.08, 0.08, 0.08),
    gray = rgb(0.34, 0.34, 0.34),
    line = rgb(0.35, 0.35, 0.35);
  const left = 48,
    right = width - 48,
    contentWidth = right - left;
  function text(
    value: string,
    x: number,
    top: number,
    size = 10.5,
    font: PDFFont = mincho,
    color = ink,
  ) {
    page.drawText(value, { x, y: height - top - size, size, font, color });
  }
  function rule(top: number, start = left, end = right, thickness = 0.5) {
    page.drawLine({
      start: { x: start, y: height - top },
      end: { x: end, y: height - top },
      thickness,
      color: line,
    });
  }
  function box(x: number, top: number, w: number, h: number, shaded = false) {
    page.drawRectangle({
      x,
      y: height - top - h,
      width: w,
      height: h,
      borderColor: line,
      borderWidth: 0.5,
      ...(shaded ? { color: rgb(0.95, 0.95, 0.95) } : {}),
    });
  }
  const title = '2026年度 公開講座 受講申込書';
  text('様式第1号', left, 36, 9, mincho, gray);
  text('受講者記入用', right - gothic.widthOfTextAtSize('受講者記入用', 9), 36, 9, gothic, gray);
  text(title, (width - mincho.widthOfTextAtSize(title, 18)) / 2, 68, 18);
  text('申込日', 340, 114, 10);
  rule(134, 390);
  text('みどり学習センター　講座担当 御中', left, 153, 11);
  text('下記の講座について、受講を申し込みます。', left, 183);
  text('必要事項をご記入のうえ、内容をご確認ください。', left, 200, 9.5, mincho, gray);

  const courseRows = [
    ['講座名', '地域活動のための広報・デザイン基礎講座'],
    ['開催日時', '2026年11月14日（土） 13:00 - 16:00'],
    ['会場・定員', 'みどり学習センター 第2研修室 ／ 定員24名'],
  ];
  courseRows.forEach(([label, value], index) => {
    const top = 230 + index * 27;
    box(left, top, 104, 27, true);
    box(152, top, contentWidth - 104, 27);
    text(label, 62, top + 8, 9.5, gothic);
    text(value, 164, top + 8, 10);
  });
  text('1. 申込者情報', left, 331, 11, gothic);
  text('※ 氏名・メールアドレスは必須です。', 326, 334, 8.5, mincho, gray);
  const applicantRows = ['氏名', 'フリガナ', '所属・団体名', 'メールアドレス', '電話番号'];
  applicantRows.forEach((label, index) => {
    const top = 354 + index * 36;
    box(left, top, 104, 36, true);
    box(152, top, contentWidth - 104, 36);
    text(label, 60, top + 12, 9.5, gothic);
  });
  text('2. 受講の目的・連絡事項', left, 554, 11, gothic);
  text('（任意）', 203, 555, 9, mincho, gray);
  box(left, 578, contentWidth, 68);

  // This printed box matches the checkbox's PDF-space appearance geometry.
  box(51, 668, 16, 16);
  text('下記の個人情報の取り扱いを確認し、同意します。', 77, 670, 10.5);
  text('【個人情報の取り扱い】', left, 703, 9.5, gothic);
  text(
    'ご記入いただいた情報は、受講者の受付、講座運営および開催に関する連絡に使用します。',
    left,
    721,
    9,
  );
  text('ご本人の同意なく、上記以外の目的で使用することはありません。', left, 737, 9);
  text(
    '記入上の注意：変更・欠席のご連絡は、講座担当までお知らせください。',
    left,
    768,
    8.5,
    mincho,
    gray,
  );
  rule(790);
  text('記入用サンプル（架空の団体・講座です）', left, 800, 8, mincho, gray);
  text('1 / 1', right - 26, 800, 8, mincho, gray);

  const fieldDefs: {
    label: string;
    type: FieldType;
    x: number;
    y: number;
    width: number;
    height: number;
    required: boolean;
    placeholder: string;
  }[] = [
    {
      label: '氏名',
      type: 'text',
      x: 160,
      y: 359,
      width: 379,
      height: 26,
      required: true,
      placeholder: '山田 太郎',
    },
    {
      label: 'フリガナ',
      type: 'text',
      x: 160,
      y: 395,
      width: 379,
      height: 26,
      required: false,
      placeholder: 'ヤマダ タロウ',
    },
    {
      label: '所属・団体名',
      type: 'text',
      x: 160,
      y: 431,
      width: 379,
      height: 26,
      required: false,
      placeholder: '会社名・団体名など',
    },
    {
      label: 'メールアドレス',
      type: 'email',
      x: 160,
      y: 467,
      width: 379,
      height: 26,
      required: true,
      placeholder: 'yamada@example.com',
    },
    {
      label: '電話番号',
      type: 'text',
      x: 160,
      y: 503,
      width: 379,
      height: 26,
      required: false,
      placeholder: '090-1234-5678',
    },
    {
      label: '申込日',
      type: 'date',
      x: 394,
      y: 108,
      width: 149,
      height: 24,
      required: true,
      placeholder: '',
    },
    {
      label: '受講の目的・連絡事項',
      type: 'textarea',
      x: 54,
      y: 584,
      width: 487,
      height: 56,
      required: false,
      placeholder: '学びたいことや、事前に伝えたいことをご記入ください。',
    },
    {
      label: '個人情報の取り扱いに同意する',
      type: 'checkbox',
      x: 48,
      y: 664,
      width: 24,
      height: 24,
      required: true,
      placeholder: '',
    },
  ];
  const definition: Definition = {
    title,
    description:
      '公開講座の受講申込フォームです。申込日・氏名・メールアドレスなどをご記入ください。※架空の団体・講座を使ったサンプルです。',
    fields: fieldDefs.map((f) => ({
      ...f,
      id: randomUUID(),
      page: 0,
      x: f.x / width,
      y: f.y / height,
      width: f.width / width,
      height: f.height / height,
    })),
  };
  pdf.setTitle(title);
  pdf.setAuthor('Forme サンプル文書');
  pdf.setSubject('架空の公開講座の受講申込書・A4縦');
  await writeFile('public/sample-form.pdf', await pdf.save());
  await writeFile(
    'public/sample-form.json',
    JSON.stringify({ pages: [{ width, height }], definition }, null, 2),
  );
  console.log('A4 sample application and matching field definitions created');
}
main();
