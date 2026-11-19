import type { Metadata } from 'next';
import { UD_AD_NOTICE_VERSION } from '@/lib/ud-ad-consent';
import { assetPath } from '@/lib/basePath';

export const metadata: Metadata = { title: '広告計測への任意同意について｜RIDE JOB', robots: { index: false, follow: false } };

export default function UdMeasurementNotice() {
  return <main className="mx-auto max-w-2xl space-y-5 px-5 py-8 text-base leading-8 text-gray-900 [&_a]:text-blue-700 [&_a]:underline [&_h2]:text-lg [&_h2]:font-bold">
    <h1 className="text-2xl font-bold">広告計測への任意同意について</h1>
    <p>株式会社PM Agentが運営するRIDE JOBのUDトラックス製造・組立職の応募フォームに関する説明です。内容をご確認のうえ、広告計測に同意するかお選びください。同意しなくても、応募・求人の紹介・担当者との相談に影響はありません。</p>
    <h2>利用目的・送信するタイミング</h2>
    <p>広告の効果を測定し、配信を改善するため、任意チェックに同意して応募した場合に限り、応募完了情報をMeta・Googleへ送信します。このフォームでは、同意前・未同意の場合に広告タグを読み込んだり、応募完了情報を広告会社へ送ったりしません。</p>
    <h2>送信先と情報</h2>
    <p><strong>Meta Platforms, Inc.（米国）</strong>：応募完了の日時・識別子、求人ID、応募ページのURL、メールアドレス・電話番号のハッシュ値、Cookieの広告識別子、IPアドレス、ブラウザー・端末情報を送信します。Metaはアカウント情報等と照合して広告効果の測定や配信改善に利用します。ハッシュ化は元の文字列をそのまま送らないための処理ですが、匿名化ではありません。</p>
    <p><strong>Google LLC（米国）</strong>：応募完了の識別子、広告クリック情報、ページURL、Cookie等の識別情報、IPアドレス、ブラウザー・端末情報を送信し、Google広告の効果測定に利用します。Googleへメールアドレス・電話番号を渡す拡張コンバージョンや、広告のパーソナライズは、この導線では使用しません。</p>
    <p>いずれにも氏名・住所・生年月日・応募の回答本文は送信しません。この導線からOpenAIへ応募情報を送信することもありません。</p>
    <h2>米国の制度と各社の取扱い</h2>
    <p>情報は米国の事業者へ提供されます。日本と米国では個人情報保護の制度や本人の権利が異なります。米国には分野別・州ごとの制度があります。制度の違いは、<a href="https://www.ppc.go.jp/enforcement/infoprovision/laws/offshore_report_america/" target="_blank" rel="noopener noreferrer">個人情報保護委員会の米国の制度に関する情報</a>をご確認ください。</p>
    <p>提供先による情報の利用・保存・保護の措置・開示等の手続きは、<a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer">Metaのプライバシーポリシー</a>・<a href="https://www.facebook.com/legal/terms/businesstools" target="_blank" rel="noopener noreferrer">Metaビジネスツール利用規約</a>、<a href="https://policies.google.com/privacy?hl=ja" target="_blank" rel="noopener noreferrer">Googleのプライバシーポリシー</a>をご確認ください。各社が保有する情報と結び付けて取り扱う場合があります。</p>
    <h2>選択の変更・お問い合わせ</h2>
    <p>応募送信前は任意チェックを外せます。今回の選択を次の応募へ自動で引き継ぐことはありません。送信後の利用停止等のご相談は、<a href={assetPath('/ud-manufacturing/policy#contact')} target="_blank" rel="noopener noreferrer">当社プライバシーポリシー第7項の窓口</a>へご連絡ください。すでに提供した情報の扱いは、法令・各提供先の手続きに沿って対応します。</p>
    <p>応募受付・連絡・当社内での応募経路の集計に必要な処理は、広告計測への同意とは別に、当社プライバシーポリシーに従って行います。任意同意の有無・説明の版・確認日時は当社で記録します。</p>
    <p className="text-sm text-gray-600">説明版：{UD_AD_NOTICE_VERSION}</p>
  </main>;
}
