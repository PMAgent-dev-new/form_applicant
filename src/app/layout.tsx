import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import { BASE_PATH } from "@/lib/basePath";
import AttributionCapture from "./components/AttributionCapture";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * dual-run（並行稼働）中かどうか。
 * 同じコードが2つの deployment に載っている:
 *   BASE_PATH=/entry → https://ridejob.jp/entry/*（新・移管先）
 *   BASE_PATH 未設定 → https://ridejob.pmagent.jp/*（旧・現に応募が流れている本番）
 * 判定に新しい環境変数は増やさず、既存の BASE_PATH をそのままゾーンの識別に使う。
 */
const IS_ENTRY_ZONE = BASE_PATH !== "";

export const metadata: Metadata = {
  // og:image などの相対パスを絶対URLへ解決する起点。未指定だと Next が Vercel の
  // 環境変数から推測し、ridejob-entry.vercel.app という内部URLが og:image に漏れる。
  metadataBase: new URL(
    IS_ENTRY_ZONE ? "https://ridejob.jp" : "https://ridejob.pmagent.jp",
  ),
  // ルートの title に職種を入れない。以前はタクシー文言だったため、自前の metadata を
  // 持たない /mechanic などが「タクシー運転手の転職なら…」を継承してしまっていた。
  // 職種名は各ルートの page/layout 側で名乗る。
  title: "ライドジョブ（RIDE JOB）｜応募フォーム",
  description: "未経験でもわかるドライバー業界の魅力発掘メディア。\nライドジョブは仕事のやりがいやリアルな声、キャリアの可能性など、ドライバー業界の魅力を発見・共有する情報発信プラットフォームです。経験者の声や成功事例、未経験からのキャリアスタートのヒントなど、幅広い情報をお届けします。",
  icons: {
    icon: `${BASE_PATH}/favicon.png`,
  },
  // 並行稼働中は新ゾーンだけを検索対象から外す（移管計画 §5 の dual-run 設定）。
  // 新ゾーンが index されない以上、両ゾーンが重複として競合すること自体が起きないので、
  // GSC の「Duplicate without user-selected canonical」はこれで解消する。
  //
  // canonical は敢えて付けない。noindex のページは重複統合の対象にならないため効かず、
  // Google が明示的に非推奨とする矛盾シグナルになる。さらに16ルート全部が layout を
  // 継承するので、§7 で noindex を外したときに外し忘れると移管先が1ページに潰れる。
  // 自己参照 canonical が要るのは §7 の最終切替時で、そのときルートごとに入れる。
  //
  // ⚠️ 旧ゾーン側には絶対に付けない。旧を noindex にすると移管完了前に検索流入が消える。
  ...(IS_ENTRY_ZONE ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;

  return (
    <html lang="ja">
      <head>
        {/* basePath 配下では /public 画像が `${BASE_PATH}/...` で配信されるため、背景画像URLを注入する。
            PNG → WebP に変更し転送量を削減（mobile 814KB→146KB / pc 556KB→58KB）。

            ⚠️ mobile は `mobile-bg-838.webp` を使う。既存の `mobile-bg.webp`(563x1233) は
               PNG(838x1984)の変換版ではなく**別クリエイティブ**（webp=タクシー版 / png=整備士版）で、
               参照すると全ルートのモバイル背景が差し替わってしまうため使わない。
               `mobile-bg-838.webp` は現行 PNG を同一寸法で忠実に変換したもの＝見た目は不変。

            image-set() は使わない。CSS変数経由だと構文非対応ブラウザ（iOS16以前のSafari／
            同OSのアプリ内ブラウザ）で var() 置換後に不正値となり background-image が none に
            落ちて背景が消える。かつ本リポジトリは他の画像を素の .webp で参照済みで、
            PNGフォールバックの受益者は実質いない。 */}
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--app-bg-mobile:url('${BASE_PATH}/images/mobile-bg-838.webp');--app-bg-pc:url('${BASE_PATH}/images/pc-bg.webp');}`,
          }}
        />

        {/* Meta Pixel */}
        {metaPixelId && (
          <script
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`,
            }}
          />
        )}
        {/* End Meta Pixel */}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script
          id="gtm-script"
          strategy="lazyOnload"
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-5CQGTMXF');`
          }}
        />
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-5CQGTMXF"
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>

        {/* Meta Pixel (noscript) */}
        {metaPixelId && (
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              alt=""
              src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`}
            />
          </noscript>
        )}
        {/* End Meta Pixel (noscript) */}

        {/* 着地時点の流入元を Cookie に取り込む（UI なし）。詳細は lib/attribution.ts */}
        <AttributionCapture />

        {children}
      </body>
    </html>
  );
}
