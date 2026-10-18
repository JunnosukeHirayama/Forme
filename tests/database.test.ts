import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const database = new PGlite();
const owner = randomUUID(),
  other = randomUUID();
const definition = {
  title: '公開講座',
  description: '',
  fields: [
    {
      id: randomUUID(),
      type: 'text',
      label: '氏名',
      page: 0,
      x: 0.2,
      y: 0.3,
      width: 0.4,
      height: 0.05,
      required: true,
      placeholder: '',
    },
  ],
};
async function scalar(sql: string, args: unknown[] = []) {
  return (await database.query<{ value: any }>(sql, args)).rows[0].value;
}
async function createForm(user = owner) {
  const id = randomUUID();
  await scalar('select public.reserve_upload($1,$2,$3,$4) as value', [user, id, '申込書.pdf', 100]);
  return await scalar('select to_jsonb(public.register_form($1,$2,$3,$4,$5)) as value', [
    user,
    id,
    JSON.stringify([{ width: 600, height: 800 }]),
    JSON.stringify(definition),
    100,
  ]);
}
before(async () => {
  // Only auth/storage infrastructure is stubbed. All application DDL, policies and functions are the real migrations.
  await database.exec(`create schema auth;create table auth.users(id uuid primary key);
    create role anon;create role authenticated;create role service_role bypassrls;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  for (const file of ['202610180001_cloud.sql', '202610180003_pagination.sql'])
    await database.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await database.query('insert into auth.users(id) values($1),($2)', [owner, other]);
});
after(() => database.close());
test('RLS denies anonymous reads and isolates account reads; browser mutation and privileged RPC are denied', async () => {
  const a = await createForm(),
    b = await createForm(other);
  await database.exec('set role anon');
  await assert.rejects(database.query('select * from public.forms'), /permission denied/);
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await database.exec('set role authenticated');
  try {
    const rows = await database.query<{ id: string }>('select id from public.forms');
    assert.ok(rows.rows.some((r) => r.id === a.id));
    assert.ok(!rows.rows.some((r) => r.id === b.id));
    await assert.rejects(
      database.query("update public.forms set status='published'"),
      /permission denied/,
    );
    await assert.rejects(
      database.query('select public.reserve_upload($1,$2,$3,$4)', [
        owner,
        randomUUID(),
        'x.pdf',
        100,
      ]),
      /permission denied/,
    );
    await assert.rejects(database.query('select * from public.uploads'), /permission denied/);
  } finally {
    await database.exec('reset role');
  }
});
test('upload reservation ownership, exact byte size, expiry and immutable registration', async () => {
  const id = randomUUID();
  await scalar('select public.reserve_upload($1,$2,$3,$4) as value', [owner, id, 'x.pdf', 100]);
  const args = [
    owner,
    id,
    JSON.stringify([{ width: 600, height: 800 }]),
    JSON.stringify(definition),
    100,
  ];
  await assert.rejects(
    database.query('select public.register_form($1,$2,$3,$4,$5)', [other, ...args.slice(1)]),
    /upload_missing/,
  );
  await assert.rejects(
    database.query('select public.register_form($1,$2,$3,$4,$5)', [...args.slice(0, 4), 101]),
    /upload_size/,
  );
  const a = await scalar('select to_jsonb(public.register_form($1,$2,$3,$4,$5)) as value', args);
  const b = await scalar('select to_jsonb(public.register_form($1,$2,$3,$4,$5)) as value', args);
  assert.equal(a.id, b.id);
  assert.equal(a.source_path, `sources/${owner}/${id}.pdf`);
  assert.equal(
    await scalar('select count(*)::int as value from public.storage_gc where path=$1', [
      a.source_path,
    ]),
    0,
  );
  const expired = randomUUID();
  await scalar('select public.reserve_upload($1,$2,$3,$4) as value', [
    other,
    expired,
    'x.pdf',
    100,
  ]);
  await database.query(
    "update public.uploads set expires_at=now()-interval '1 minute' where id=$1",
    [expired],
  );
  await assert.rejects(
    database.query('select public.register_form($1,$2,$3,$4,$5)', [
      other,
      expired,
      ...args.slice(2),
    ]),
    /upload_expired/,
  );
});
test('publication, repeated concurrent requests, changed payloads and closure share a transaction', async () => {
  const form = await createForm();
  const token = randomUUID();
  await database.query(
    "update public.forms set published=draft,published_revision=revision,token=$2,status='published' where id=$1",
    [form.id, token],
  );
  const key = randomUUID(),
    args = [
      form.id,
      1,
      JSON.stringify(definition),
      JSON.stringify({ name: '山田 太郎' }),
      key,
      'hash-one',
      'receipt-one',
    ];
  const query = 'select public.accept_submission($1,$2,$3,$4,$5,$6,$7) as value';
  const [a, b] = await Promise.all([scalar(query, args), scalar(query, args)]);
  assert.equal(a.id, b.id);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(
    await scalar('select response_count as value from public.forms where id=$1', [form.id]),
    1,
  );
  await assert.rejects(
    database.query(query, [...args.slice(0, 5), 'changed-hash', 'other']),
    /retry_conflict/,
  );
  await database.query(
    "update public.forms set published_revision=2,published=jsonb_set(draft,'{title}','\"更新後\"') where id=$1",
    [form.id],
  );
  await assert.rejects(
    database.query(query, [...args.slice(0, 4), randomUUID(), 'new-hash', 'new-receipt']),
    /version_conflict/,
  );
  await database.query("update public.forms set status='closed' where id=$1", [form.id]);
  assert.equal((await scalar(query, args)).id, a.id);
  await assert.rejects(
    database.query(query, [...args.slice(0, 4), randomUUID(), 'h', 'r']),
    /form_closed/,
  );
  const snapshot = await scalar('select definition as value from public.submissions where id=$1', [
    a.id,
  ]);
  assert.equal(snapshot.title, definition.title);
});
test('cross-account listing, ten-row pagination, server search and fixed CSV time boundary', async () => {
  const f = await createForm();
  await database.query(
    "update public.forms set published=draft,published_revision=1,status='published' where id=$1",
    [f.id],
  );
  for (let i = 0; i < 13; i++)
    await scalar('select public.accept_submission($1,1,$2,$3,$4,$5,$6) as value', [
      f.id,
      JSON.stringify(definition),
      JSON.stringify({ name: `参加者${i}` }),
      randomUUID(),
      `hash${i}`,
      randomUUID(),
    ]);
  const page = await scalar('select public.list_submissions($1,$2,0) as value', [owner, f.id]);
  assert.equal(page.items.length, 10);
  assert.equal(page.total, 13);
  const next = await scalar('select public.list_submissions($1,$2,1) as value', [owner, f.id]);
  assert.equal(next.items.length, 3);
  assert.equal(
    (await scalar('select public.list_submissions($1,$2,0) as value', [other, f.id])).total,
    0,
  );
  const search = await scalar('select public.list_submissions($1,$2,0,$3) as value', [
    owner,
    f.id,
    '参加者12',
  ]);
  assert.equal(search.total, 1);
  const past = await scalar(
    "select public.list_submissions($1,$2,0,'',now()-interval '1 hour') as value",
    [owner, f.id],
  );
  assert.equal(past.total, 0);
});
test('account byte quota and pending upload quota cannot be bypassed by parallel reservations', async () => {
  const user = randomUUID();
  await database.query('insert into auth.users(id) values($1)', [user]);
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      scalar('select public.reserve_upload($1,$2,$3,$4) as value', [
        user,
        randomUUID(),
        'x.pdf',
        100,
      ]),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  assert.match(
    String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason),
    /quota_pending/,
  );
  const large = await createForm();
  await database.query('update public.forms set source_bytes=12582912 where id=$1', [large.id]);
  for (let i = 0; i < 7; i++) {
    const f = await createForm();
    await database.query('update public.forms set source_bytes=12582912 where id=$1', [f.id]);
  }
  await assert.rejects(
    database.query('select public.reserve_upload($1,$2,$3,$4)', [
      owner,
      randomUUID(),
      'large.pdf',
      12582912,
    ]),
    /quota_storage/,
  );
});
test('distributed rate limits reset only after their window expires', async () => {
  assert.equal(await scalar("select public.take_rate_limit('test-key',2,600) as value"), true);
  assert.equal(await scalar("select public.take_rate_limit('test-key',2,600) as value"), true);
  assert.equal(await scalar("select public.take_rate_limit('test-key',2,600) as value"), false);
  await database.exec(
    "update public.rate_limits set expires_at=now()-interval '1 second' where key='test-key'",
  );
  assert.equal(await scalar("select public.take_rate_limit('test-key',2,600) as value"), true);
});
test('soft deletion revokes RLS access and queues source garbage collection after the retention window', async () => {
  const f = await createForm(other);
  await database.query(
    "update public.forms set deleted_at=now()-interval '31 days',status='closed' where id=$1",
    [f.id],
  );
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  await database.exec('set role authenticated');
  assert.equal(
    (await database.query('select id from public.forms where id=$1', [f.id])).rows.length,
    0,
  );
  await database.exec('reset role');
  await database.exec('select public.prepare_cleanup()');
  assert.equal(
    await scalar('select count(*)::int as value from public.forms where id=$1', [f.id]),
    0,
  );
  assert.equal(
    await scalar('select count(*)::int as value from public.storage_gc where path=$1', [
      f.source_path,
    ]),
    1,
  );
});
