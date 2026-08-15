import type { Metadata } from 'next';

// 完了ページ本体は 'use client' のため metadata を持てない。ロケットナウ用に上書きする。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜ロケットナウ求人特設フォーム',
  // 完了ページは検索結果に出す意味が無い。旧ドメイン(ridejob.pmagent.jp)は
  // robots.txt も sitemap.xml も404で被index可能なため、固有titleを付けると
  // これまで重複として畳まれていたページが単独で索引されうる。mount時に dataLayer へ
  // form_complete を push するので、検索経由の着地は偽コンバージョンにもなる。
  // 先例 truck/applicants/new/layout.tsx と揃える。
  robots: { index: false, follow: false },
};

export default function CoupangApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
