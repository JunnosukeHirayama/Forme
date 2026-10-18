import { execFileSync } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
const raw = JSON.parse(
  execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);
if (!/^http:\/\/(127\.0\.0\.1|localhost):56421$/.test(raw.API_URL))
  throw new Error('この作品専用のローカルSupabaseだけが対象です');
try {
  await access('.env.local');
  throw new Error('.env.local が既に存在します。上書きせず終了します');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const publicKey = raw.PUBLISHABLE_KEY || raw.ANON_KEY,
  secretKey = raw.SECRET_KEY || raw.SERVICE_ROLE_KEY;
if (!publicKey || !secretKey) throw new Error('ローカルの接続情報を取得できませんでした');
await writeFile(
  '.env.local',
  `NEXT_PUBLIC_SUPABASE_URL=${raw.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publicKey}\nSUPABASE_SECRET_KEY=${secretKey}\nSITE_URL=http://localhost:3001\nNEXT_PUBLIC_ALLOW_SIGNUP=false\nNEXT_PUBLIC_TURNSTILE_SITE_KEY=\nTURNSTILE_SECRET_KEY=\nCRON_SECRET=local-development-only-not-for-production\n`,
  { mode: 0o600 },
);
const admin = createClient(raw.API_URL, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await admin.auth.admin.createUser({
  email: 'demo@example.com',
  email_confirm: true,
});
if (error && !/already|registered/.test(error.message))
  throw new Error('ローカル体験用アカウントを準備できませんでした');
console.log(
  'ローカル専用 .env.local を作成しました。demo@example.com の確認コードは http://127.0.0.1:56424 で確認できます。',
);
