export function cloudConfigured() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY
  );
}
export const MAX_PDF_BYTES = 12 * 1024 * 1024;
export const STORAGE_BUCKET = 'forme-private';
