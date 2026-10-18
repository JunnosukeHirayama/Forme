import { Responses } from '@/components/responses';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Responses id={(await params).id} />;
}
