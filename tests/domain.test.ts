import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  clampRect,
  definitionSchema,
  topLeftToPdf,
  validateValues,
  type Definition,
  type Field,
} from '../src/lib/domain';

const field: Field = {
  id: randomUUID(),
  type: 'text',
  label: '名前',
  page: 0,
  x: 0.2,
  y: 0.3,
  width: 0.4,
  height: 0.05,
  required: true,
  placeholder: '',
};
const definition: Definition = { title: 'テスト', description: '', fields: [field] };
test('top-left normalized coordinates map to PDF bottom-left independently of display zoom', () => {
  const box = topLeftToPdf(field, { width: 600, height: 800 });
  assert.equal(box.x, 120);
  assert.equal(box.width, 240);
  assert.ok(Math.abs(box.y - 520) < 0.00001);
  assert.equal(box.height, 40);
});
test('clamping keeps moved and resized fields on the page', () => {
  const box = clampRect({ x: 1.3, y: -0.5, width: 0.4, height: 0.2 });
  assert.deepEqual(box, { x: 0.6, y: 0, width: 0.4, height: 0.2 });
  const huge = clampRect({ x: 0.4, y: 0.2, width: 4, height: 2 });
  assert.deepEqual(huge, { x: 0, y: 0, width: 1, height: 1 });
});
test('definition rejects duplicate IDs, off-page fields and blank titles', () => {
  assert.equal(definitionSchema.safeParse(definition).success, true);
  assert.equal(
    definitionSchema.safeParse({ ...definition, fields: [field, field] }).success,
    false,
  );
  assert.equal(
    definitionSchema.safeParse({ ...definition, fields: [{ ...field, x: 0.8 }] }).success,
    false,
  );
  assert.equal(definitionSchema.safeParse({ ...definition, title: '  ' }).success, false);
});
test('required fields, boolean types, email and actual calendar dates are checked', () => {
  const date = { ...field, id: randomUUID(), type: 'date' as const },
    email = { ...field, id: randomUUID(), type: 'email' as const },
    check = { ...field, id: randomUUID(), type: 'checkbox' as const };
  const d = { ...definition, fields: [field, date, email, check] };
  const invalid = validateValues(d, {
    [field.id]: ' ',
    [date.id]: '2026-02-30',
    [email.id]: 'broken',
    [check.id]: 'true',
  });
  assert.equal(Object.keys(invalid.errors).length, 4);
  const valid = validateValues(d, {
    [field.id]: ' 山田 太郎 ',
    [date.id]: '2028-02-29',
    [email.id]: 'test@example.com',
    [check.id]: true,
    extra: 'discard',
  });
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.values[field.id], '山田 太郎');
  assert.equal('extra' in valid.values, false);
});
