import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adminSupabase } from './supabase/server';
import { HttpError, now, secret } from './http';
import { definitionSchema } from './domain';
import { MAX_PDF_BYTES, STORAGE_BUCKET } from './config';
import { inspectPdf } from './pdf';
import type {
  Definition,
  FormRecord,
  PageSize,
  PublicForm,
  SubmissionPage,
  Values,
} from './domain';

export interface FormRow {
  id: string;
  owner_id: string;
  draft: Definition;
  revision: number;
  published: Definition | null;
  published_revision: number | null;
  token: string | null;
  status: FormRecord['status'];
  filename: string;
  source_path: string;
  source_bytes: number;
  pages: PageSize[];
  created_at: string;
  updated_at: string;
  response_count: number;
  deleted_at: string | null;
}
export interface SubmissionRow {
  id: string;
  form_id: string;
  definition: Definition;
  version: number;
  answers: Values;
  receipt_token: string;
  idempotency_key: string;
  payload_hash: string;
  submitted_at: string;
}
export interface UploadRow {
  id: string;
  owner_id: string;
  filename: string;
  declared_bytes: number;
  staging_path: string;
  completed_at: string | null;
  expires_at: string;
}
export function databaseError(error: { message: string; code?: string } | null): never {
  const code = error?.message || '';
  if (/quota_/.test(code))
    throw new HttpError(
      422,
      '保存上限に達しています（50フォーム・PDF合計100MB・1フォーム1000回答）。不要なデータの整理、または管理者へのお問い合わせをお願いします。',
    );
  if (/upload_expired/.test(code))
    throw new HttpError(410, 'アップロードの有効期限が切れました。ファイルを選び直してください');
  if (/upload_size/.test(code))
    throw new HttpError(422, 'ファイルサイズが一致しません。再アップロードしてください');
  if (/upload_missing|form_missing/.test(code)) throw new HttpError(404, '対象が見つかりません');
  if (/form_closed/.test(code)) throw new HttpError(410, 'このフォームの受付は終了しました');
  if (/retry_conflict|version_conflict/.test(code))
    throw new HttpError(
      409,
      'フォームまたは送信内容が変更されています。再読み込みして確認してください',
    );
  throw new HttpError(503, '保存処理を完了できませんでした。しばらくしてから再試行してください');
}
export async function ownedForm(id: string, owner: string): Promise<FormRow> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
    throw new HttpError(404, 'フォームが見つかりません');
  const { data, error } = await adminSupabase()
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('owner_id', owner)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new HttpError(404, 'フォームが見つかりません');
  return data as FormRow;
}
export async function publicForm(token: string, allowClosed = false): Promise<FormRow> {
  const { data, error } = await adminSupabase()
    .from('forms')
    .select('*')
    .eq('token', token)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new HttpError(404, 'フォームが見つかりません');
  if (!allowClosed && data.status !== 'published')
    throw new HttpError(410, 'このフォームの受付は終了しました');
  return data as FormRow;
}
export function toRecord(row: FormRow): FormRecord {
  return {
    id: row.id,
    title: row.draft.title,
    description: row.draft.description,
    filename: row.filename,
    draft: row.draft,
    revision: row.revision,
    publishedRevision: row.published_revision,
    token: row.token,
    status: row.status,
    pages: row.pages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    responseCount: row.response_count,
  };
}
export function toPublic(row: FormRow, preview = false): PublicForm {
  const definition = preview ? row.draft : row.published!;
  return {
    id: row.id,
    title: definition.title,
    description: definition.description,
    definition,
    version: preview ? row.revision : row.published_revision!,
    pages: row.pages,
    filename: row.filename,
  };
}
export async function listForms(owner: string) {
  const { data, error } = await adminSupabase()
    .from('forms')
    .select('*')
    .eq('owner_id', owner)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) databaseError(error);
  return (data as FormRow[]).map(toRecord);
}
export async function reserveUpload(owner: string, filename: string, size: number) {
  const { data, error } = await adminSupabase()
    .rpc('reserve_upload', {
      p_owner: owner,
      p_id: randomUUID(),
      p_filename: filename,
      p_size: size,
    })
    .single();
  if (error) databaseError(error);
  return data as UploadRow;
}
export async function queueGarbage(path: string, hours = 24) {
  const { error } = await adminSupabase()
    .from('storage_gc')
    .upsert({ path, delete_after: new Date(Date.now() + hours * 3600000).toISOString() });
  if (error) databaseError(error);
}
export async function storageUpload(path: string, bytes: Uint8Array) {
  const { error } = await adminSupabase()
    .storage.from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false, cacheControl: '0' });
  if (error) throw new HttpError(503, 'PDFを保存できませんでした。再試行してください');
}
export async function downloadSource(path: string) {
  const { data, error } = await adminSupabase().storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) throw new HttpError(503, 'PDFを読み込めませんでした');
  if (data.size > MAX_PDF_BYTES) throw new HttpError(413, 'PDFは12MB以内にしてください');
  return new Uint8Array(await data.arrayBuffer());
}
export async function signedFile(path: string, filename?: string) {
  const { data, error } = await adminSupabase()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(path, 60, filename ? { download: filename } : undefined);
  if (error || !data) throw new HttpError(503, 'ダウンロードURLを作成できませんでした');
  return data.signedUrl;
}
export async function exportedFile(bytes: Uint8Array, filename: string) {
  const path = `exports/${randomUUID()}.pdf`;
  await queueGarbage(path);
  await storageUpload(path, bytes);
  return signedFile(path, filename);
}
async function register(
  owner: string,
  u: UploadRow,
  bytes: Uint8Array,
  pages: PageSize[],
  definition: Definition,
) {
  const path = `sources/${owner}/${u.id}.pdf`;
  // Queue before writing, so a failed DB commit never leaves an untracked object.
  await queueGarbage(path);
  const { error: uploadError } = await adminSupabase()
    .storage.from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false, cacheControl: '0' });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message))
    throw new HttpError(503, 'PDFを保存できませんでした');
  const { data, error } = await adminSupabase()
    .rpc('register_form', {
      p_owner: owner,
      p_upload: u.id,
      p_pages: pages,
      p_definition: definition,
      p_size: bytes.length,
    })
    .single();
  if (error) databaseError(error);
  return toRecord(data as FormRow);
}
export async function finishUpload(owner: string, id: string) {
  const { data, error } = await adminSupabase()
    .from('uploads')
    .select('*')
    .eq('id', id)
    .eq('owner_id', owner)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new HttpError(404, 'アップロードが見つかりません');
  const u = data as UploadRow;
  if (u.completed_at) return toRecord(await ownedForm(id, owner));
  if (Date.parse(u.expires_at) < Date.now())
    throw new HttpError(410, 'アップロードの有効期限が切れました');
  const bytes = await downloadSource(u.staging_path);
  if (bytes.length !== u.declared_bytes) throw new HttpError(422, 'ファイルサイズが一致しません');
  const pages = await inspectPdf(bytes);
  return register(owner, u, bytes, pages, {
    title: u.filename.replace(/\.pdf$/i, '').slice(0, 100) || '無題のフォーム',
    description: '',
    fields: [],
  });
}
export async function createSample(owner: string) {
  const meta = JSON.parse(await readFile('public/sample-form.json', 'utf-8')) as {
    pages: PageSize[];
    definition: Definition;
  };
  const definition = definitionSchema.parse({
    ...meta.definition,
    fields: meta.definition.fields.map((f) => ({ ...f, id: randomUUID() })),
  });
  const bytes = new Uint8Array(await readFile('public/sample-form.pdf'));
  const reservation = await reserveUpload(owner, `${definition.title}.pdf`, bytes.length);
  return register(owner, reservation, bytes, await inspectPdf(bytes), definition);
}
export async function saveForm(row: FormRow, definition: unknown, revision: number) {
  if (row.revision !== revision)
    throw new HttpError(409, 'フォームが更新されています。再読み込みしてください');
  const validated = definitionSchema.parse(definition);
  if (validated.fields.some((f) => f.page >= row.pages.length))
    throw new HttpError(422, '存在しないページに入力欄があります');
  const { data, error } = await adminSupabase()
    .from('forms')
    .update({ draft: validated, revision: revision + 1, updated_at: now() })
    .eq('id', row.id)
    .eq('owner_id', row.owner_id)
    .eq('revision', revision)
    .is('deleted_at', null)
    .select()
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new HttpError(409, '別の画面で更新されています。再読み込みしてください');
  return toRecord(data as FormRow);
}
export async function publishForm(row: FormRow, revision: number) {
  if (row.revision !== revision)
    throw new HttpError(409, 'フォームが更新されています。再読み込みしてください');
  const definition = definitionSchema.parse(row.draft);
  if (!definition.fields.length)
    throw new HttpError(422, '公開するには入力欄を1つ以上追加してください');
  const { data, error } = await adminSupabase()
    .from('forms')
    .update({
      published: definition,
      published_revision: revision,
      token: row.token || secret(),
      status: 'published',
      updated_at: now(),
    })
    .eq('id', row.id)
    .eq('owner_id', row.owner_id)
    .eq('revision', revision)
    .is('deleted_at', null)
    .select()
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new HttpError(409, 'フォームが更新されています。保存してから公開してください');
  return toRecord(data as FormRow);
}
export async function submissions(
  owner: string,
  formId: string | null = null,
  page = 0,
  search = '',
  before = now(),
): Promise<SubmissionPage> {
  const { data, error } = await adminSupabase().rpc('list_submissions', {
    p_owner: owner,
    p_form: formId,
    p_page: page,
    p_search: search,
    p_before: before,
  });
  if (error) databaseError(error);
  return data as SubmissionPage;
}
export async function previousSubmission(formId: string, key: string) {
  const { data, error } = await adminSupabase()
    .from('submissions')
    .select('*')
    .eq('form_id', formId)
    .eq('idempotency_key', key)
    .maybeSingle();
  if (error) databaseError(error);
  return data as SubmissionRow | null;
}
