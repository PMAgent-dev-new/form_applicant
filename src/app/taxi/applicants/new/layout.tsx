import type { Metadata } from 'next';

// `/applicants/new` の再エクスポートだが、別ルート＝別 layout なので metadata も個別に持つ。
export const metadata: Metadata = {
  title: 'ご応募ありがとうございました｜タクシー運転手の転職ならライドジョブ',
  // 完了ページは検索結果に出す意味が無い。旧ドメイン(ridejob.pmagent.jp)は
  // robots.txt も sitemap.xml も404で被index可能なため、固有titleを付けると
  // これまで重複として畳まれていたページが単独で索引されうる。mount時に dataLayer へ
  // form_complete を push するので、検索経由の着地は偽コンバージョンにもなる。
  // 先例 truck/applicants/new/layout.tsx と揃える。
  robots: { index: false, follow: false },
};

export default function TaxiApplicationCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
