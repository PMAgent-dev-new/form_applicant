import type { Metadata } from 'next';
import ApplicationForm from '../components/ApplicationForm';

export const metadata: Metadata = {
  title: '新卒・第二新卒の整備士求人ならライドジョブメカニック｜応募フォーム',
  description:
    'ホワイト企業への整備士就職ならライドジョブメカニック。新卒・第二新卒歓迎の整備士求人を、給与・休日・職場環境まで確認したうえでご紹介します。',
};

export default function MechanicNewGradPage() {
  return <ApplicationForm preset="mechanic_newgrad" peopleImageSrc="/images/kange2.webp" variant="A" showPeopleImage={false} />;
}
