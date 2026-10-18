import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3107';
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3107'],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_SECRET_KEY: '',
      SITE_URL: base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let logs = '';
child.stdout.on('data', (c) => (logs += c));
child.stderr.on('data', (c) => (logs += c));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`${base}/login`);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!ready) throw new Error(`Smoke server failed to start: ${logs}`);
  assert.equal((await fetch(`${base}/login`)).status, 200);
  const root = await fetch(base, { redirect: 'manual' });
  assert.equal(root.status, 307);
  assert.equal(new URL(root.headers.get('location'), base).pathname, '/login');
  const protectedPage = await fetch(`${base}/forms/00000000-0000-4000-8000-000000000000`, {
    redirect: 'manual',
  });
  assert.equal(protectedPage.status, 307);
  assert.equal((await fetch(`${base}/api/forms`)).status, 503);
  assert.equal(
    (
      await fetch(`${base}/api/forms`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(`${base}/api/maintenance`)).status, 401);
  console.log(
    'Production HTTP smoke passed: setup page, protected routes, missing config, CSRF and cron authentication.',
  );
} finally {
  child.kill('SIGTERM');
}
