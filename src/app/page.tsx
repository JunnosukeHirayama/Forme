import { Dashboard } from '@/components/dashboard';
import { requirePageUser } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requirePageUser();
  return <Dashboard email={user.email || ''} />;
}
