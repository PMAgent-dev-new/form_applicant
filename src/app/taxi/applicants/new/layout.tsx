import type { Metadata } from 'next';

// `/applicants/new` の再エクスポートだが、別ルート＝別 layout なので metadata も個別に持つ。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜タクシー運転手の転職ならライドジョブ',
};

export default function TaxiApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
