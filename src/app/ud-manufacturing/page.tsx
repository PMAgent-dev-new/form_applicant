import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getUdLaunchConfig } from '@/lib/ud-manufacturing';
import UdApplicationForm from './UdApplicationForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'UDトラックス 製造・組立｜RIDE JOB',
  description: 'UDトラックス上尾工場の未経験可・正社員の製造・組立募集。応募受付はRIDE JOB（人材紹介）。',
  robots: { index: false, follow: false },
};

export default function UdManufacturingPage() {
  const config = getUdLaunchConfig();
  if (!config) notFound();
  return <UdApplicationForm jobId={config.jobId} />;
}
