import type { Metadata } from 'next';

// 完了ページ本体は 'use client' のため metadata を持てない。バス用に上書きする。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜バス運転手の転職ならライドジョブ',
};

export default function BusApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
