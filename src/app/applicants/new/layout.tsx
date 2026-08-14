import type { Metadata } from 'next';

// 完了ページ本体は 'use client' のため metadata を持てない。`/` と `/people-b`
// （preset=default＝タクシー導線）の完了ページなので、タクシー文言をここで名乗る。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜タクシー運転手の転職ならライドジョブ',
};

export default function ApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
