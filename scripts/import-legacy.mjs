import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const workspace = arg('--workspace'),
  owner = arg('--owner');
if (![workspace, owner].every((x) => /^[0-9a-f-]{36}$/i.test(x || '')))
  throw new Error('--workspace と --owner のUUIDを明示してください');
const legacy = new DatabaseSync(process.env.DATABASE_PATH || '.data/forme.sqlite', {
  readOnly: true,
});
const forms = legacy.prepare('select * from forms where workspace_id=?').all(workspace);
console.log(`移行対象: ${forms.length}フォーム。元のSQLiteは読み取り専用です。`);
if (!process.argv.includes('--apply')) {
  console.log('確認のみで終了しました。実行には --target 接続先ホスト名 --apply が必要です。');
  legacy.close();
  process.exit(0);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || new URL(url).hostname !== arg('--target'))
  throw new Error('--target がSupabaseの接続先と一致しません');
const client = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: user, error: userError } = await client.auth.admin.getUserById(owner);
if (userError || !user.user?.email_confirmed_at)
  throw new Error('移行先の確認済みアカウントが見つかりません');
const checked = (result) => {
  if (result.error)
    throw new Error(
      `移行処理で停止しました (${result.error.code || 'storage'})。元データは保持されています。`,
    );
  return result.data;
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
let imported = 0;
try {
  for (const f of forms) {
    const draft = JSON.parse(f.draft_json),
      pages = JSON.parse(f.pages_json),
      path = `sources/${owner}/${f.id}.pdf`;
    const existing = checked(await client.from('forms').select('*').eq('id', f.id).maybeSingle());
    if (existing) {
      if (
        existing.owner_id !== owner ||
        existing.source_path !== path ||
        existing.revision !== f.revision ||
        JSON.stringify(existing.draft) !== JSON.stringify(draft)
      ) {
        // jsonb key order may differ; compare canonical JSON through sorted keys below instead.
        const canonical = (v) =>
          JSON.stringify(v, (_k, x) =>
            x && typeof x === 'object' && !Array.isArray(x)
              ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
              : x,
          );
        if (
          existing.owner_id !== owner ||
          existing.source_path !== path ||
          existing.revision !== f.revision ||
          canonical(existing.draft) !== canonical(draft)
        )
          throw new Error('同じIDの移行先に別の内容があります。上書きせず停止しました');
      }
    } else {
      let reservation = checked(
        await client
          .from('uploads')
          .select('id')
          .eq('id', f.id)
          .eq('owner_id', owner)
          .maybeSingle(),
      );
      if (!reservation)
        reservation = checked(
          await client
            .rpc('reserve_upload', {
              p_owner: owner,
              p_id: f.id,
              p_filename: f.filename,
              p_size: f.pdf.length,
            })
            .single(),
        );
      checked(
        await client
          .from('storage_gc')
          .upsert({ path, delete_after: new Date(Date.now() + 86400000).toISOString() }),
      );
      const uploaded = await client.storage
        .from('forme-private')
        .upload(path, f.pdf, { contentType: 'application/pdf', upsert: false, cacheControl: '0' });
      if (uploaded.error) {
        const stored = checked(await client.storage.from('forme-private').download(path));
        if (digest(new Uint8Array(await stored.arrayBuffer())) !== digest(f.pdf))
          throw new Error('移行先のPDFが異なります。上書きせず停止しました');
      }
      checked(
        await client
          .rpc('register_form', {
            p_owner: owner,
            p_upload: f.id,
            p_pages: pages,
            p_definition: draft,
            p_size: f.pdf.length,
          })
          .single(),
      );
      checked(
        await client
          .from('forms')
          .update({
            revision: f.revision,
            published: f.published_json ? JSON.parse(f.published_json) : null,
            published_revision: f.published_revision,
            token: f.token,
            status: f.status,
            created_at: f.created_at,
            updated_at: f.updated_at,
          })
          .eq('id', f.id)
          .eq('owner_id', owner),
      );
    }
    const answers = legacy.prepare('select * from submissions where form_id=?').all(f.id);
    for (const s of answers) {
      const prior = checked(
        await client
          .from('submissions')
          .select('payload_hash,form_id')
          .eq('id', s.id)
          .maybeSingle(),
      );
      if (prior) {
        if (prior.form_id !== f.id || prior.payload_hash !== s.payload_hash)
          throw new Error('移行先の回答が異なります。上書きせず停止しました');
        continue;
      }
      checked(
        await client.from('submissions').insert({
          id: s.id,
          form_id: f.id,
          definition: JSON.parse(s.definition_json),
          version: s.version,
          answers: JSON.parse(s.values_json),
          receipt_token: s.receipt_token,
          idempotency_key: s.idempotency_key,
          payload_hash: s.payload_hash,
          submitted_at: s.submitted_at,
        }),
      );
    }
    const counted = await client
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', f.id);
    checked(counted);
    checked(
      await client
        .from('forms')
        .update({ response_count: counted.count })
        .eq('id', f.id)
        .eq('owner_id', owner),
    );
    imported++;
  }
} finally {
  legacy.close();
}
console.log(
  `${imported}フォームの移行が完了しました。フォームID・公開URLのトークン・回答控えを保持しています。`,
);
