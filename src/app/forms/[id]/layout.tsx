import { requirePageUser } from '@/lib/auth';
import { ownedForm } from '@/lib/forms';
import { notFound } from 'next/navigation';
import { HttpError } from '@/lib/http';
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  try {
    await ownedForm((await params).id, user.id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  return children;
}
