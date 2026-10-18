import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { adminSupabase } from './supabase/server';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, string>,
  ) {
    super(message);
  }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const now = () => new Date().toISOString();
export async function limitedBytes(request: Request, maximum: number) {
  if (Number(request.headers.get('content-length')) > maximum)
    throw new HttpError(413, '送信データが大きすぎます');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new HttpError(413, '送信データが大きすぎます');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
export async function body(request: Request) {
  const text = new TextDecoder().decode(await limitedBytes(request, 256_000));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSONの形式が正しくありません');
  }
}
export function origin(request: Request) {
  const expected = process.env.SITE_URL
    ? new URL(process.env.SITE_URL).origin
    : new URL(request.url).origin;
  const value = request.headers.get('origin');
  if (value !== expected) throw new HttpError(403, 'この操作は同じサイトから実行してください');
}
export function clientAddress(request: Request) {
  // Vercel overwrites this header. Do not trust user-supplied cf-connecting-ip / x-forwarded-for.
  return process.env.VERCEL === '1'
    ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    : 'local';
}
export async function limit(key: string, max = 40, seconds = 600) {
  const { data, error } = await adminSupabase().rpc('take_rate_limit', {
    p_key: hash(key),
    p_max: max,
    p_seconds: seconds,
  });
  if (error) throw new HttpError(503, 'アクセス制御を確認できませんでした');
  if (!data) throw new HttpError(429, 'リクエストが多いため、しばらくしてからお試しください');
}
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpError)
        return NextResponse.json(
          { error: error.message, details: error.details },
          { status: error.status, headers: { 'Cache-Control': 'no-store' } },
        );
      if (error instanceof ZodError)
        return NextResponse.json(
          { error: error.issues[0]?.message || '入力内容を確認してください' },
          { status: 422 },
        );
      // Never log PDF contents, answer values, email addresses, tokens or complete Supabase errors.
      console.error('request_failed', { type: error instanceof Error ? error.name : 'unknown' });
      return NextResponse.json(
        { error: '処理を完了できませんでした。もう一度お試しください。' },
        { status: 500 },
      );
    }
  };
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export function redirectFile(url: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: url,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
