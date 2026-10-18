import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cloudConfigured } from '../config';

export async function serverSupabase() {
  if (!cloudConfigured()) throw new Error('Supabase configuration missing');
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll(items) {
          try {
            items.forEach(({ name, value, options }) => jar.set(name, value, options));
          } catch {
            /* Read-only Server Components; proxy refreshes before rendering. */
          }
        },
      },
    },
  );
}
// Never export this client to a Client Component. Each API authorization uses a verified user first.
export function adminSupabase() {
  if (!cloudConfigured()) throw new Error('Supabase configuration missing');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
