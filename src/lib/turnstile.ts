import 'server-only';
import { HttpError } from './http';
export async function verifyTurnstile(token: string | undefined, action: string) {
  const key = process.env.TURNSTILE_SECRET_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production')
      throw new HttpError(503, '不正送信対策の設定が必要です');
    return;
  }
  if (!token || token.length > 2048) throw new HttpError(422, '確認チェックを完了してください');
  let result: { success: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: key, response: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('siteverify');
    result = await response.json();
  } catch {
    throw new HttpError(503, '確認サービスに接続できませんでした。再試行してください');
  }
  const hostname = process.env.SITE_URL ? new URL(process.env.SITE_URL).hostname : 'localhost';
  if (!result.success || result.hostname !== hostname || result.action !== action)
    throw new HttpError(422, '確認の有効期限が切れたか、確認に失敗しました。再度お試しください');
}
