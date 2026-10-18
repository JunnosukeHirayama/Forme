import { Respondent } from '@/components/respondent';
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <Respondent token={(await params).token} />;
}
