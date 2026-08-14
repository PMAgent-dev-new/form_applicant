import type { Metadata } from 'next';

// 完了ページ本体は 'use client' のため metadata を持てない。ロケットナウ用に上書きする。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜ロケットナウ求人特設フォーム',
};

export default function CoupangApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
