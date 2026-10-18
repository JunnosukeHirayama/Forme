import { Respondent } from '@/components/respondent';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Respondent token={(await params).id} preview />;
}
