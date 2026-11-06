import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBrandConfig } from '@/lib/email/templates/application-confirmation';
import { getUdLaunchConfig } from '@/lib/ud-manufacturing';
import CompletionEvent from './CompletionEvent';

export const metadata: Metadata = { title: '応募受付完了｜RIDE JOB', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function UdApplicationComplete() {
  if (!getUdLaunchConfig()) notFound();
  return <main className="mx-auto max-w-md p-6 text-gray-900">
    <CompletionEvent />
    <h1 className="my-6 text-2xl font-bold">ご応募ありがとうございます</h1>
    <p className="mb-4">UDトラックス上尾工場の製造・組立職へのご応募を、RIDE JOB（人材紹介）が受け付けました。</p>
    <p className="mb-6">担当者より、ご希望や応募条件を確認のうえ、選考の進め方をご案内します。</p>
    <a className="block rounded bg-orange-800 p-4 text-center font-bold text-white" href={getBrandConfig('ud_manufacturing').bookingUrl}>担当者との面談日時を選ぶ</a>
  </main>;
}
