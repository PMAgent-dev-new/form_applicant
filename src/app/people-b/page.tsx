import type { Metadata } from 'next';
import ApplicationForm from '@/app/components/ApplicationForm';

// preset 未指定＝default（タクシー導線）の variant B。文言はルート `/` と揃える。
export const metadata: Metadata = {
  title: 'タクシー運転手の転職ならライドジョブ｜応募フォーム',
};

export default function PageB() {
  return <ApplicationForm peopleImageSrc="/images/1754984488274.png" variant="B" />;
}
