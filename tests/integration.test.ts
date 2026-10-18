import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, degrees } from 'pdf-lib';
import { filledPdf, inspectPdf } from '../src/lib/pdf';
import { definitionSchema, type Values } from '../src/lib/domain';

test('Japanese PDF round trip preserves all canonical values, widgets, appearance streams and geometry', async () => {
  const source = new Uint8Array(await readFile('public/sample-form.pdf'));
  const { definition: raw } = JSON.parse(await readFile('public/sample-form.json', 'utf8'));
  const definition = definitionSchema.parse(raw);
  const values: Values = Object.fromEntries(
    definition.fields.map((f) => [
      f.id,
      f.type === 'checkbox'
        ? true
        : f.type === 'date'
          ? '2026-11-14'
          : f.type === 'email'
            ? 'test@example.com'
            : f.type === 'textarea'
              ? '地域活動に活用したいです。\nよろしくお願いします。'
              : '山田 太郎',
    ]),
  );
  const filled = await PDFDocument.load(await filledPdf(source, definition, values));
  const form = filled.getForm();
  assert.equal(form.getFields().length, 8);
  for (const f of definition.fields) {
    const name = `forme.${f.id}`;
    if (f.type === 'checkbox') assert.equal(form.getCheckBox(name).isChecked(), true);
    else assert.equal(form.getTextField(name).getText(), values[f.id]);
    const widgets = form.getField(name).acroField.getWidgets();
    assert.equal(widgets.length, 1);
    assert.ok(widgets[0].getNormalAppearance());
    if (f.type === 'text') assert.ok(Math.abs(widgets[0].getRectangle().x - f.x * 595.28) <= 1);
  }
  assert.equal((await inspectPdf(source)).length, 1);
});
test('PDF export rejects missing glyphs and overflow instead of silently dropping answer text', async () => {
  const bytes = new Uint8Array(await readFile('public/sample-form.pdf'));
  const { definition } = JSON.parse(await readFile('public/sample-form.json', 'utf8'));
  const field = definition.fields.find((f: { type: string }) => f.type === 'text');
  await assert.rejects(
    filledPdf(bytes, { ...definition, fields: [field] }, { [field.id]: '山田😀' }),
    /入力欄に収まらない/,
  );
  await assert.rejects(
    filledPdf(bytes, { ...definition, fields: [field] }, { [field.id]: 'あ'.repeat(160) }),
    /入力欄に収まらない/,
  );
});
test('multiple page output maps normalized positions to the correct page and rejects rotated source PDFs', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  pdf.addPage([500, 700]);
  const source = await pdf.save();
  assert.equal((await inspectPdf(source)).length, 2);
  const { definition } = JSON.parse(await readFile('public/sample-form.json', 'utf8'));
  const f = { ...definition.fields[0], page: 1, x: 0.2, y: 0.3, width: 0.4, height: 0.08 };
  const filled = await PDFDocument.load(
    await filledPdf(source, { ...definition, fields: [f] }, { [f.id]: '二枚目の回答' }),
  );
  const widget = filled.getForm().getTextField(`forme.${f.id}`).acroField.getWidgets()[0];
  assert.ok(Math.abs(widget.getRectangle().x - 100) <= 1);
  assert.ok(Math.abs(widget.getRectangle().y - 434) <= 1);
  pdf.getPage(0).setRotation(degrees(90));
  await assert.rejects(inspectPdf(await pdf.save()), /回転/);
});
