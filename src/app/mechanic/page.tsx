import type { Metadata } from 'next';
import ApplicationForm from '../components/ApplicationForm';
import { INSTRUCTOR_FORM_TITLE, resolveMechanicRole } from '@/lib/mechanic-role';

const mechanicMetadata: Metadata = {
  title: '自動車整備士の転職ならライドジョブメカニック｜応募フォーム',
  description:
    'ホワイト企業への整備士転職ならライドジョブメカニック。給与・休日・職場環境を確認したうえで、あなたに合う整備士求人をご紹介します。',
};

type MechanicPageProps = { searchParams: Promise<{ role?: string | string[] }> };

export async function generateMetadata({ searchParams }: MechanicPageProps): Promise<Metadata> {
  const { role } = await searchParams;
  return resolveMechanicRole('mechanic', role) === 'instructor'
    ? { title: `${INSTRUCTOR_FORM_TITLE}｜ライドジョブメカニック`, description: '整備士教員の仕事を希望する方向けの登録フォームです。' }
    : mechanicMetadata;
}

export default async function MechanicPage({ searchParams }: MechanicPageProps) {
  const { role } = await searchParams;
  return <ApplicationForm preset="mechanic" mechanicRole={resolveMechanicRole('mechanic', role)} peopleImageSrc="/images/kange2.webp" variant="A" showPeopleImage={false} />;
}
