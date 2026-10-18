import { redirect } from 'next/navigation';
import { Login } from '@/components/login';
import { currentUser } from '@/lib/auth';
import { cloudConfigured } from '@/lib/config';
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (await currentUser()) redirect('/');
  return (
    <Login
      configured={cloudConfigured()}
      allowSignup={process.env.NEXT_PUBLIC_ALLOW_SIGNUP === 'true'}
    />
  );
}
