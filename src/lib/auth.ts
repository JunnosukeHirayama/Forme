import 'server-only';
import { redirect } from 'next/navigation';
import { serverSupabase } from './supabase/server';
import { cloudConfigured } from './config';
import { HttpError } from './http';
export async function currentUser() {
  if (!cloudConfigured()) return null;
  const supabase = await serverSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.is_anonymous || !data.user.email_confirmed_at) return null;
  return data.user;
}
export async function requireUser() {
  if (!cloudConfigured()) throw new HttpError(503, 'クラウド接続の設定が必要です');
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'ログインしてください');
  return user;
}
export async function requirePageUser() {
  if (!cloudConfigured()) redirect('/login');
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}
