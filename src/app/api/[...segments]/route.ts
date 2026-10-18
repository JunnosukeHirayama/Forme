import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { adminSupabase } from '@/lib/supabase/server';
import {
  body,
  hash,
  HttpError,
  json,
  limit,
  now,
  origin,
  redirectFile,
  route,
  secret,
  clientAddress,
} from '@/lib/http';
import {
  createSample,
  ownedForm,
  publicForm,
  publishForm,
  saveForm,
  submissions,
  toPublic,
  toRecord,
  listForms,
  reserveUpload,
  finishUpload,
  databaseError,
  downloadSource,
  signedFile,
  exportedFile,
  previousSubmission,
  type FormRow,
  type SubmissionRow,
} from '@/lib/forms';
import { filledPdf } from '@/lib/pdf';
import { validateValues } from '@/lib/domain';
import { MAX_PDF_BYTES, STORAGE_BUCKET, cloudConfigured } from '@/lib/config';
import { verifyTurnstile } from '@/lib/turnstile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const uuid = z.string().uuid();
const handler = route(async (request) => {
  const [resource, id, action, item, format] = new URL(request.url).pathname
    .slice(5)
    .split('/')
    .filter(Boolean);
  const query = new URL(request.url).searchParams;
  const page = Math.min(5000, Math.max(0, Number(query.get('page')) || 0));
  const search = (query.get('search') || '').slice(0, 160);
  const before = query.has('before') ? z.string().datetime().parse(query.get('before')) : now();
  const method = request.method;
  if (method !== 'GET') origin(request);
  if (!cloudConfigured()) throw new HttpError(503, 'クラウド接続の設定が必要です');
  if (resource === 'workspace' && method === 'POST') {
    const user = await requireUser();
    return json({ id: user.id, email: user.email });
  }
  if (resource === 'uploads' && method === 'POST') {
    const user = await requireUser();
    await limit(`upload:${user.id}`, 20);
    if (!id) {
      const input = z
        .object({
          filename: z
            .string()
            .min(1)
            .max(200)
            .regex(/\.pdf$/i),
          size: z.number().int().min(1).max(MAX_PDF_BYTES),
        })
        .parse(await body(request));
      const reservation = await reserveUpload(user.id, input.filename, input.size);
      const { data, error } = await adminSupabase()
        .storage.from(STORAGE_BUCKET)
        .createSignedUploadUrl(reservation.staging_path, { upsert: false });
      if (error || !data) throw new HttpError(503, 'アップロード先を準備できませんでした');
      return json({ id: reservation.id, path: reservation.staging_path, token: data.token });
    }
    if (action === 'complete') return json(await finishUpload(user.id, uuid.parse(id)), 201);
  }
  if (resource === 'forms') {
    const user = await requireUser();
    if (!id && method === 'GET') return json(await listForms(user.id));
    if (!id && method === 'POST') {
      await limit(`create:${user.id}`, 20);
      return json(await createSample(user.id), 201);
    }
    const row = await ownedForm(uuid.parse(id), user.id);
    if (!action && method === 'GET') return json(toRecord(row));
    if (!action && method === 'PATCH') {
      const data = z
        .object({ definition: z.unknown(), revision: z.number().int().positive() })
        .parse(await body(request));
      return json(await saveForm(row, data.definition, data.revision));
    }
    if (!action && method === 'DELETE') {
      const { error } = await adminSupabase()
        .from('forms')
        .update({ deleted_at: now(), status: 'closed' })
        .eq('id', row.id)
        .eq('owner_id', user.id);
      if (error) databaseError(error);
      return json({ deleted: true });
    }
    if (action === 'pdf' && method === 'GET')
      return redirectFile(await signedFile(row.source_path));
    if (action === 'preview' && method === 'GET') return json(toPublic(row, true));
    if (action === 'preview-pdf' && method === 'POST') {
      await limit(`export:${user.id}`, 30);
      await limit(`export-day:${user.id}`, 100, 86400);
      const { values, errors } = validateValues(row.draft, (await body(request)).values);
      if (Object.keys(errors).length)
        throw new HttpError(422, '入力内容を確認してください', errors);
      const bytes = await filledPdf(await downloadSource(row.source_path), row.draft, values);
      return json({ url: await exportedFile(bytes, `${row.draft.title}_プレビュー.pdf`) });
    }
    if (action === 'publish' && method === 'POST') {
      const data = z.object({ revision: z.number().int().positive() }).parse(await body(request));
      return json(await publishForm(row, data.revision));
    }
    if (action === 'status' && method === 'POST') {
      const { status } = z
        .object({ status: z.enum(['published', 'closed']) })
        .parse(await body(request));
      if (!row.published) throw new HttpError(422, '先にフォームを公開してください');
      const { error } = await adminSupabase()
        .from('forms')
        .update({ status, updated_at: now() })
        .eq('id', row.id)
        .eq('owner_id', user.id)
        .is('deleted_at', null);
      if (error) databaseError(error);
      return json(toRecord(await ownedForm(row.id, user.id)));
    }
    if (action === 'submissions' && method === 'GET') {
      if (item && format === 'pdf') {
        await limit(`export:${user.id}`, 30);
        await limit(`export-day:${user.id}`, 100, 86400);
        const { data, error } = await adminSupabase()
          .from('submissions')
          .select('*')
          .eq('id', uuid.parse(item))
          .eq('form_id', row.id)
          .maybeSingle();
        if (error) databaseError(error);
        if (!data) throw new HttpError(404, '回答が見つかりません');
        const r = data as SubmissionRow;
        return redirectFile(
          await exportedFile(
            await filledPdf(await downloadSource(row.source_path), r.definition, r.answers),
            `${r.definition.title}_回答.pdf`,
          ),
        );
      }
      return json(await submissions(user.id, row.id, Math.floor(page), search, before));
    }
  }
  if (resource === 'submissions' && method === 'GET' && !id)
    return json(
      await submissions((await requireUser()).id, null, Math.floor(page), search, before),
    );
  if (resource === 'public' && id) {
    if (id.length > 100) throw new HttpError(404, 'フォームが見つかりません');
    if (method === 'GET') {
      const row = await publicForm(id);
      if (action === 'pdf') {
        await limit(`source:${hash(id)}:${clientAddress(request)}`, 120);
        return redirectFile(await signedFile(row.source_path));
      }
      if (!action) return json(toPublic(row));
    }
    if (action === 'submit' && method === 'POST') {
      await limit(`public-write:${clientAddress(request)}`, 120);
      await limit(`submit:${hash(id)}:${clientAddress(request)}`, 60);
      const input = z
        .object({
          version: z.number().int().positive(),
          values: z.unknown(),
          idempotencyKey: uuid,
          turnstileToken: z.string().max(2048).optional(),
        })
        .parse(await body(request));
      const row = await publicForm(id, true),
        previous = await previousSubmission(row.id, input.idempotencyKey);
      if (!row.published && !previous) throw new HttpError(404, 'フォームが見つかりません');
      const definition = previous?.definition || row.published!;
      const { values, errors } = validateValues(definition, input.values);
      if (Object.keys(errors).length)
        throw new HttpError(422, '入力内容を確認してください', errors);
      const payloadHash = hash(JSON.stringify({ version: input.version, values }));
      if (previous) {
        if (previous.payload_hash !== payloadHash)
          throw new HttpError(409, '同じ送信IDで異なる回答は送信できません');
        return json({
          id: previous.id,
          receipt: previous.receipt_token,
          submittedAt: previous.submitted_at,
        });
      }
      if (row.status !== 'published') throw new HttpError(410, 'このフォームの受付は終了しました');
      if (input.version !== row.published_revision)
        throw new HttpError(409, 'フォームが更新されました。再読み込みしてください');
      await verifyTurnstile(input.turnstileToken, 'submit-form');
      await filledPdf(await downloadSource(row.source_path), definition, values);
      const { data, error } = await adminSupabase().rpc('accept_submission', {
        p_form: row.id,
        p_version: input.version,
        p_definition: definition,
        p_values: values,
        p_key: input.idempotencyKey,
        p_hash: payloadHash,
        p_receipt: secret(),
      });
      if (error) databaseError(error);
      return json(
        { id: data.id, receipt: data.receipt, submittedAt: data.submittedAt },
        data.created ? 201 : 200,
      );
    }
  }
  if (resource === 'receipts' && id && action === 'pdf' && method === 'GET') {
    await limit(`receipt-day:${clientAddress(request)}`, 100, 86400);
    await limit(`receipt:${hash(id)}:${clientAddress(request)}`, 20);
    const { data, error } = await adminSupabase()
      .from('submissions')
      .select('*, forms!inner(*)')
      .eq('receipt_token', id)
      .is('forms.deleted_at', null)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data) throw new HttpError(404, '回答が見つかりません');
    const r = data as SubmissionRow & { forms: FormRow };
    return redirectFile(
      await exportedFile(
        await filledPdf(await downloadSource(r.forms.source_path), r.definition, r.answers),
        `${r.definition.title}_回答.pdf`,
      ),
    );
  }
  throw new HttpError(404, '見つかりません');
});
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
