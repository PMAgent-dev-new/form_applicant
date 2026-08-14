import type { Metadata } from 'next';
import ApplicationForm from '../components/ApplicationForm';

export const metadata: Metadata = {
  title: '自動車整備士の転職ならライドジョブメカニック｜応募フォーム',
  description:
    'ホワイト企業への整備士転職ならライドジョブメカニック。給与・休日・職場環境を確認したうえで、あなたに合う整備士求人をご紹介します。',
};

export default function MechanicPage() {
  return <ApplicationForm preset="mechanic" peopleImageSrc="/images/kange2.webp" variant="A" showPeopleImage={false} />;
}
