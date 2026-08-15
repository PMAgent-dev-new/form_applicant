import type { Metadata } from 'next';
import ApplicationForm from './components/ApplicationForm';

// preset="default" はタクシーの導線（ヘッダー「未経験でタクシー会社に就職するなら」）。
// 以前はルート layout のタクシー文言を継承していたが、layout をブランド汎用にしたので
// ここで職種を名乗る。/taxi は同じ画面の別URLなので同じ文言を持つ。
export const metadata: Metadata = {
  title: 'タクシー運転手の転職ならライドジョブ｜応募フォーム',
};

export default function Home() {
  return <ApplicationForm preset="default" peopleImageSrc="/images/kange2.webp" variant="A" showPeopleImage={false} />;
}
