import { z } from 'zod';

export const fieldTypes = ['text', 'textarea', 'email', 'date', 'checkbox'] as const;
export type FieldType = (typeof fieldTypes)[number];
export const fieldNames: Record<FieldType, string> = {
  text: 'テキスト',
  textarea: '複数行テキスト',
  email: 'メールアドレス',
  date: '日付',
  checkbox: 'チェックボックス',
};
export const fieldSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(fieldTypes),
    label: z.string().trim().min(1).max(80),
    page: z.number().int().min(0).max(49),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.02).max(1),
    height: z.number().min(0.015).max(1),
    required: z.boolean(),
    placeholder: z.string().max(120),
  })
  .refine(
    (f) => f.x + f.width <= 1.000001 && f.y + f.height <= 1.000001,
    '入力欄はページ内に配置してください',
  );
export const definitionSchema = z
  .object({
    title: z.string().trim().min(1, 'タイトルを入力してください').max(100),
    description: z.string().max(500),
    fields: z.array(fieldSchema).max(100),
  })
  .refine(
    (d) => new Set(d.fields.map((f) => f.id)).size === d.fields.length,
    '入力欄のIDが重複しています',
  );
export type Field = z.infer<typeof fieldSchema>;
export type Definition = z.infer<typeof definitionSchema>;
export type Values = Record<string, string | boolean>;
export interface PageSize {
  width: number;
  height: number;
}
export interface FormRecord {
  id: string;
  title: string;
  description: string;
  filename: string;
  draft: Definition;
  revision: number;
  publishedRevision: number | null;
  token: string | null;
  status: 'draft' | 'published' | 'closed';
  pages: PageSize[];
  createdAt: string;
  updatedAt: string;
  responseCount: number;
}
export interface PublicForm {
  id: string;
  title: string;
  description: string;
  definition: Definition;
  version: number;
  pages: PageSize[];
  filename: string;
}
export interface SubmissionRecord {
  id: string;
  formId: string;
  title: string;
  values: Values;
  definition: Definition;
  submittedAt: string;
  version: number;
}

export function validateValues(
  definition: Definition,
  input: unknown,
): { values: Values; errors: Record<string, string> } {
  const parsed = z
    .record(z.string(), z.union([z.string().max(2000), z.boolean()]))
    .safeParse(input);
  if (!parsed.success) return { values: {}, errors: { _form: '回答の形式を確認してください' } };
  const values: Values = {};
  const errors: Record<string, string> = {};
  for (const field of definition.fields) {
    const raw = parsed.data[field.id];
    if (field.type === 'checkbox') {
      const value = raw === true;
      values[field.id] = value;
      if (raw !== undefined && typeof raw !== 'boolean')
        errors[field.id] = 'チェックの形式を確認してください';
      else if (field.required && !value) errors[field.id] = 'チェックを入れてください';
      continue;
    }
    if (raw !== undefined && typeof raw !== 'string') {
      errors[field.id] = '文字で入力してください';
      continue;
    }
    const value = typeof raw === 'string' ? raw.trim() : '';
    values[field.id] = value;
    if (field.required && !value) errors[field.id] = '入力してください';
    else if (value && field.type === 'email' && !z.email().safeParse(value).success)
      errors[field.id] = 'メールアドレスを確認してください';
    else if (value && field.type === 'date') {
      const date = new Date(`${value}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      )
        errors[field.id] = '有効な日付を入力してください';
    }
    if (field.type !== 'textarea' && value.length > 160)
      errors[field.id] = '160文字以内で入力してください';
    if (field.type === 'textarea' && value.length > 1000)
      errors[field.id] = '1,000文字以内で入力してください';
    if (field.type !== 'textarea' && /[\r\n]/.test(value))
      errors[field.id] = '改行は使用できません';
  }
  return { values, errors };
}

export function topLeftToPdf(field: Field, page: PageSize) {
  return {
    x: field.x * page.width,
    y: (1 - field.y - field.height) * page.height,
    width: field.width * page.width,
    height: field.height * page.height,
  };
}

export function clampRect(rect: Pick<Field, 'x' | 'y' | 'width' | 'height'>) {
  const width = Math.min(1, Math.max(0.025, rect.width));
  const height = Math.min(1, Math.max(0.02, rect.height));
  return {
    width,
    height,
    x: Math.max(0, Math.min(1 - width, rect.x)),
    y: Math.max(0, Math.min(1 - height, rect.y)),
  };
}

export interface SubmissionPage {
  items: SubmissionRecord[];
  total: number;
  page: number;
  pageSize: number;
}
