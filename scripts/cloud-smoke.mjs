// Runs only against this app's disposable local Supabase, never a hosted or existing project.
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):56421$/.test(url || ''))
  throw new Error('このテストは専用のローカルSupabase（56421）でのみ実行できます');
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const base = 'http://127.0.0.1:3108',
  users = [],
  objects = new Set();
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3108'],
  {
    env: {
      ...process.env,
      NEXT_DIST_DIR: '.next-cloud-test',
      SITE_URL: base,
      TURNSTILE_SECRET_KEY: '',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});
function remember(location) {
  const match = new URL(location).pathname.match(/\/object\/sign\/forme-private\/(.+)/);
  if (match) objects.add(decodeURIComponent(match[1]));
}
async function user() {
  const email = `test-${randomUUID()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  assert.equal(error, null, 'test account creation');
  users.push(data.user.id);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  assert.equal(linkError, null, 'test login link');
  const jar = new Map();
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(items) {
        items.forEach(({ name, value }) => jar.set(name, value));
      },
    },
  });
  const { error: authError } = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  assert.equal(authError, null, 'test OTP verification');
  const call = (path, method = 'GET', body) =>
    fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        Origin: base,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { id: data.user.id, client, call };
}
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/login`)).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, 'local Next server boot');
  const a = await user(),
    b = await user();
  const created = await a.call('/api/forms', 'POST', {});
  assert.equal(created.status, 201, 'sample registration via Storage + RPC');
  let form = await created.json();
  objects.add(`sources/${a.id}/${form.id}.pdf`);
  assert.equal((await b.call(`/api/forms/${form.id}`)).status, 404, 'owner API isolation');
  assert.equal(
    (await b.client.from('forms').select('id').eq('id', form.id)).data.length,
    0,
    'real Postgres RLS isolation',
  );
  const anonymous = createClient(url, key, { auth: { persistSession: false } });
  assert.ok((await anonymous.from('forms').select('id')).error, 'anonymous table denial');
  const rawPDF = await a.call(`/api/forms/${form.id}/pdf`);
  assert.equal(rawPDF.status, 303);
  const sourceBytes = await (await fetch(rawPDF.headers.get('location'))).arrayBuffer();
  assert.ok(sourceBytes.byteLength > 4500000, 'large PDF bypasses Vercel response payload');
  const published = await a.call(`/api/forms/${form.id}/publish`, 'POST', {
    revision: form.revision,
  });
  assert.equal(published.status, 200);
  form = await published.json();
  const def = form.draft;
  const changed = await a.call(`/api/forms/${form.id}`, 'PATCH', {
    revision: form.revision,
    definition: { ...def, title: '未公開の変更' },
  });
  assert.equal(changed.status, 200);
  form = await changed.json();
  const publicForm = await (await fetch(`${base}/api/public/${form.token}`)).json();
  assert.equal(publicForm.title, def.title, 'publication snapshot');
  const values = Object.fromEntries(
    def.fields.map((f) => [
      f.id,
      f.type === 'checkbox'
        ? true
        : f.type === 'date'
          ? '2026-11-14'
          : f.type === 'email'
            ? 'test@example.com'
            : f.type === 'textarea'
              ? '日本語の記入テストです。'
              : '山田 太郎',
    ]),
  );
  const payload = { version: publicForm.version, values, idempotencyKey: randomUUID() };
  const submit = (p) =>
    fetch(`${base}/api/public/${form.token}/submit`, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
  const retries = await Promise.all([submit(payload), submit(payload)]);
  assert.deepEqual(retries.map((r) => r.status).sort(), [200, 201], 'concurrent retry acceptance');
  const receipts = await Promise.all(retries.map((r) => r.json()));
  assert.equal(receipts[0].id, receipts[1].id);
  const list = await (await a.call(`/api/forms/${form.id}/submissions`)).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].definition.title, def.title);
  const receipt = await fetch(`${base}/api/receipts/${receipts[0].receipt}/pdf`, {
    redirect: 'manual',
  });
  assert.equal(receipt.status, 303, 'signed export redirect');
  remember(receipt.headers.get('location'));
  const filledBytes = await (await fetch(receipt.headers.get('location'))).arrayBuffer();
  const pdf = await PDFDocument.load(filledBytes);
  assert.equal(pdf.getForm().getFields().length, 8);
  for (const f of def.fields)
    if (f.type !== 'checkbox')
      assert.equal(pdf.getForm().getTextField(`forme.${f.id}`).getText(), values[f.id]);
  await mkdir('tmp/pdfs', { recursive: true });
  await writeFile('tmp/pdfs/cloud-answer.pdf', new Uint8Array(filledBytes));
  const file = await readFile('public/sample-form.pdf');
  const reserved = await a.call('/api/uploads', 'POST', {
    filename: '直接アップロード.pdf',
    size: file.length,
  });
  assert.equal(reserved.status, 200);
  const upload = await reserved.json();
  objects.add(upload.path);
  const sent = await a.client.storage
    .from('forme-private')
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: 'application/pdf' });
  assert.equal(sent.error, null, 'direct signed upload');
  assert.equal(
    (await b.call(`/api/uploads/${upload.id}/complete`, 'POST')).status,
    404,
    'upload reservation isolation',
  );
  const complete = await a.call(`/api/uploads/${upload.id}/complete`, 'POST');
  assert.equal(complete.status, 201, 'server-side PDF validation');
  objects.add(`sources/${a.id}/${upload.id}.pdf`);
  assert.equal(
    (await a.call(`/api/uploads/${upload.id}/complete`, 'POST')).status,
    201,
    'idempotent finalize',
  );
  assert.equal(
    (await a.call(`/api/forms/${form.id}/status`, 'POST', { status: 'closed' })).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/public/${form.token}`)).status, 410);
  assert.equal((await submit(payload)).status, 200, 'retry after closure');
  assert.equal(
    (await submit({ ...payload, idempotencyKey: randomUUID() })).status,
    410,
    'closed form rejects new response',
  );
  console.log(
    'Local Supabase HTTP integration passed: verified Auth cookies, RLS, private Storage, >4.5MB direct uploads/downloads, publication snapshots, concurrent retries, PDF values and closure.',
  );
} finally {
  child.kill('SIGTERM');
  for (const id of users) {
    const { data: forms } = await admin.from('forms').select('id,source_path').eq('owner_id', id);
    for (const f of forms || []) objects.add(f.source_path);
    const { data: uploads } = await admin.from('uploads').select('staging_path').eq('owner_id', id);
    for (const u of uploads || []) objects.add(u.staging_path);
    await admin.from('forms').delete().eq('owner_id', id);
    await admin.from('uploads').delete().eq('owner_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  if (objects.size) {
    await admin.storage.from('forme-private').remove([...objects]);
    await admin
      .from('storage_gc')
      .delete()
      .in('path', [...objects]);
  }
}
