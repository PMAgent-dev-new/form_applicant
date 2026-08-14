import type { Metadata } from 'next';

// 完了ページ本体は 'use client' のため metadata を持てず、ルート layout の
// 「タクシー運転手の転職なら…」がそのままタブに出ていた。トラック用に上書きする。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜トラックドライバーの転職ならライドジョブ',
  robots: { index: false, follow: false },
};

export default function TruckApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
