const skip = process.argv.includes('--if-vercel') && process.env.VERCEL !== '1';
if (!skip) {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SITE_URL',
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'CRON_SECRET',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`未設定の環境変数: ${missing.join(', ')}`);
    process.exit(1);
  }
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SITE_URL']) {
    const url = new URL(process.env[name]);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error(`${name} はオリジンだけを指定してください`);
    if (process.env.VERCEL === '1' && url.protocol !== 'https:')
      throw new Error(`${name} はHTTPSが必要です`);
  }
  if (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_') ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === process.env.SUPABASE_SECRET_KEY
  )
    throw new Error('公開キーに秘密キーが指定されています');
  if (process.env.CRON_SECRET.length < 32)
    throw new Error('CRON_SECRETには32文字以上のランダムな値が必要です');
  if (process.env.VERCEL === '1' && /^[123]x0{10}/.test(process.env.TURNSTILE_SECRET_KEY))
    throw new Error('本番環境にTurnstileのテスト用キーは使えません');
  console.log('必要な環境変数が設定されています（接続・配信の確認は別途必要です）。');
}
