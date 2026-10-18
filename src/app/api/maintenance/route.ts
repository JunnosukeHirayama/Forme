import { timingSafeEqual } from 'node:crypto';
import { adminSupabase } from '@/lib/supabase/server';
import { STORAGE_BUCKET } from '@/lib/config';
import { databaseError } from '@/lib/forms';
import { HttpError, json, route } from '@/lib/http';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const GET = route(async (request) => {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get('authorization') || '';
  if (
    !expected ||
    Buffer.byteLength(actual) !== Buffer.byteLength(`Bearer ${expected}`) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`))
  )
    throw new HttpError(401, '認証が必要です');
  const client = adminSupabase();
  const { error } = await client.rpc('prepare_cleanup');
  if (error) databaseError(error);
  const { data, error: listError } = await client
    .from('storage_gc')
    .select('path')
    .lte('delete_after', new Date().toISOString())
    .order('delete_after')
    .limit(500);
  if (listError) databaseError(listError);
  const paths = data!.map((row) => row.path as string);
  if (paths.length) {
    const { error: removeError } = await client.storage.from(STORAGE_BUCKET).remove(paths);
    if (removeError) throw new HttpError(503, 'ファイル整理を再試行します');
    const { error: ackError } = await client.from('storage_gc').delete().in('path', paths);
    if (ackError) databaseError(ackError);
  }
  return json({ removed: paths.length, morePossible: paths.length === 500 });
});
