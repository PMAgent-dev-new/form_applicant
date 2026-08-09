import type { Metadata } from 'next';
import ApplicationForm from '../components/ApplicationForm';

export const metadata: Metadata = {
  title: 'トラックドライバーの転職ならライドジョブ｜応募フォーム',
  description:
    '未経験からトラックドライバーへ。ライドジョブは仕事のやりがいやリアルな声、キャリアの可能性など、ドライバー業界の魅力を発見・共有する情報発信プラットフォームです。',
};

export default function TruckPage() {
  return <ApplicationForm preset="truck" peopleImageSrc="/images/kange2.webp" variant="A" showPeopleImage={false} />;
}
