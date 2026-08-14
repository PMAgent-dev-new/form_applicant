import type { Metadata } from 'next';

// 完了ページ本体は 'use client' のため metadata を持てない。整備士用に上書きする。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜自動車整備士の転職ならライドジョブメカニック',
};

export default function MechanicApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
