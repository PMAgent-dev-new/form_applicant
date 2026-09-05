import type { Metadata } from 'next';
import { BASE_PATH } from '@/lib/basePath';
import Image from "@/app/components/AppImage";

export const metadata: Metadata = {
  title: 'プライバシーポリシー｜ライドジョブ（RIDE JOB）',
  description: '株式会社PM Agentが運営するライドジョブにおける個人情報の取得・利用・共有についての方針です。',
};

export default function PrivacyPolicy() {
  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <header className="flex items-center justify-between p-1.5 bg-white w-[95%] mx-auto mt-2.5 rounded-md shadow">
        <div className="pl-2.5">
          <Image src="/images/ride_logo.svg" alt="Ride Job Logo" width={120} height={30} className="h-[30px] w-auto"/>
        </div>
        <div className="text-right pr-2.5">
          <p className="text-xs text-gray-800 my-1">未経験でタクシー会社に就職するなら</p>
          <p className="text-xs text-black font-bold my-1">RIDE JOB（ライドジョブ）</p>
        </div>
      </header>

      {/* Privacy Policy Content */}
      <div className="bg-white rounded-lg p-8 w-[95%] mx-auto mt-8 shadow-lg">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">プライバシーポリシー</h1>
        
        <div className="text-gray-800 leading-relaxed space-y-6">
          <p>
            株式会社PM Agent（以下「当社」といいます。）は、ユーザーの個人情報（個人情報保護法第２条第１項により定義された「個人情報」をいい、以下同様とします。）について以下のとおりプライバシーポリシー（以下「本ポリシー」といいます。）を定めます。
          </p>

          <p>
            本ポリシーは、当社がどのような個人情報を取得し、それをどのように利用・共有するか、ユーザーがどのようにご自身の個人情報を管理できるかといったことをご説明するものです。
          </p>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">1. 事業者情報</h2>
            <p>法人名：株式会社PM Agent</p>
            <p>住所　：〒150-0041　東京都渋谷区神南１−６−５ Shibuya WayP ８−４</p>
            <p>代表　：梅津　哲豪</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">2. 取得する個人情報</h2>
            <p>当社では、ご利用のサービス及びフォームの種類に応じて、次の情報の全部又は一部を取得・作成します。</p>
            <ul className="list-disc ml-6 mt-2 space-y-1">
              <li>ユーザーにご入力いただく情報：応募フォーム・お問い合わせフォーム等の送信時に、氏名、フリガナ、生年月日、郵便番号、電話番号、メールアドレス、転職を希望する時期、保有する資格・免許、希望年収など。また、郵便番号及び選択された地域から、都道府県・市区町村・町名等を取得・生成します</li>
              <li>応募後のやり取りに伴い取得・作成する情報：応募状況、面談実施状況、選考結果、内定・入社等の情報</li>
              <li>ユーザーの端末から自動的に取得・記録する情報：IPアドレス、ブラウザの種類・バージョン等の情報（ユーザーエージェント）、cookieに保存された識別子、閲覧されたページ及び参照元サイトのURL、流入元・媒体・キャンペーン・広告クリエイティブ等の広告パラメータ、広告のクリック識別子、初回及び最終の接触日時、画面の出し分け（A/Bテスト）に関する情報、応募フォームの種別、送信日時</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">3. 個人情報の利用目的</h2>
            <p>当社では、ユーザーから取得した個人情報を次に掲げる利用目的の範囲内で利用する場合があります。</p>
            <ul className="list-disc ml-6 mt-2 space-y-1">
              <li>ユーザーからのコメントやお問い合わせに回答するため</li>
              <li>ユーザーが利用しているサービスの更新情報など、必要に応じたご連絡をするため</li>
              <li>提携企業との業務提携に基づき、応募状況、面談実施状況、選考結果、内定・入社等の成約情報を共有し、サービス品質の向上、業務改善、契約条件の見直しその他業務提携の運営のために利用するため</li>
              <li>当社Webサイトの利用状況及び流入経路の把握、当社が実施した広告その他の施策の効果測定、サービスの改善並びに不正利用の防止のため</li>
            </ul>
            <p className="mt-3">
              個人情報の利用目的は、変更前後の関連性について合理性が認められる場合に限って変更するものとします。個人情報の利用目的について変更を行った際は、変更後の目的について当社所定の方法によってユーザーに通知又は公表するものとします。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">4. 個人情報を安全に管理するための措置</h2>
            <p>
              当社は、個人情報を正確かつ最新の内容に保つよう努め、不正なアクセス・改ざん・漏えい・滅失及び毀損から保護するため全従業員及び役員に対して教育研修を実施しています。また、個人情報保護規定を設け、現場での管理についても定期的な点検を行っています。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">5. 個人情報の第三者提供について</h2>
            <p>当社は以下の場合を除き、ユーザーの同意を得ないまま第三者に個人情報を提供することは致しません。</p>
            <ul className="list-disc ml-6 mt-2 space-y-1">
              <li>法令に基づく場合</li>
              <li>人の生命、身体又は財産の保護のために必要がある場合であって、本人の同意を得ることが困難であるとき</li>
              <li>公衆衛生の向上又は児童の健全な育成の推進のために特に必要がある場合であって、本人の同意を得ることが困難であるとき</li>
              <li>国の機関若しくは地方公共団体又はその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合であって、本人の同意を得ることにより当該事務の遂行に支障を及ぼすおそれがあるとき</li>
              <li>次に掲げる事項をあらかじめ本人に通知または公表し、かつ当社が個人情報保護委員会に届出をしたとき
                <ul className="list-decimal ml-6 mt-2 space-y-1">
                  <li>第三者への提供を利用目的とすること</li>
                  <li>第三者に提供される個人情報の項目</li>
                  <li>第三者への提供の方法</li>
                  <li>本人の求めに応じて当該個人情報の第三者への提供を停止すること</li>
                  <li>本人の求めを受け付ける方法</li>
                </ul>
              </li>
            </ul>
            <p className="mt-3">
              当社は、ユーザーから同意を得た場合または法令に基づく場合のほか、転職支援サービスの提供に必要な範囲において、提携企業との業務提携契約に基づき、応募状況、面談実施状況、選考結果、内定・入社等の成約情報を、サービス提供・業務改善・契約条件の見直し等を目的として提供することがあります。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">6. 匿名加工情報に関する取扱い</h2>
            <p>当社は、匿名加工情報（特定の個人を識別できないよう加工した個人情報であって、復元ができないようにしたもの）を作成する場合、以下の対応を行います。</p>
            <ul className="list-disc ml-6 mt-2 space-y-1">
              <li>法令で定める基準に従い適正な加工を施す</li>
              <li>法令で定める基準に従い安全管理措置を講じる</li>
              <li>匿名加工情報に含まれる個人に関する情報の項目を公表する</li>
              <li>作成元となった個人情報の本人を識別する目的で、当該匿名加工情報を他の情報と照合しない</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">7. 個人情報取扱いに関する相談や苦情の連絡先</h2>
            <p>
              当社の個人情報の取扱いに関するご質問やご不明点、苦情、その他のお問い合わせはお問い合わせフォームよりご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">8. cookieについて</h2>
            <p>
              cookieとは、Webサイトの閲覧時にブラウザへ保存される小さなデータのことです。当社Webサイトでは、Webサーバーから送信されるもののほか、ブラウザ上で動作するプログラムが保存するcookieがあります。当社が保存するcookieは、主に、ユーザーがどの経路で当社Webサイトに到達したかを記録し、前記「3. 個人情報の利用目的」に掲げる目的に利用します。当社は、cookieに氏名等を意図的に保存することはありません。cookieには端末やブラウザを識別するための情報等が含まれ、他の情報と組み合わせて利用される場合があります。お使いのWebブラウザの設定により、cookieを無効にすることも可能です。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">9. プライバシーポリシーの制定日及び改定日</h2>
            <p>第１版：２０２５年３月１１日　制定</p>
            <p>第２版：２０２６年７月２３日　改定</p>
            <p>第３版：２０２６年９月５日　改定</p>
          </section>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-white py-5 mt-8 bg-[#6DCFE4]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-5">
            <Image className="mb-5 w-1/4 sm:w-1/6 md:w-[150px] inline-block" src="/images/ride_logo.svg" alt="Footer Logo" width={150} height={40}/>
          </div>
          <div className="flex flex-col md:flex-row justify-around items-center text-center md:text-left text-xs mb-3 space-y-2 md:space-y-0">
            <a href="https://pmagent.jp/" className="text-white hover:underline">運営会社について</a>
            <a href={`${BASE_PATH}/privacy`} className="text-white hover:underline">プライバシーポリシー</a>
          </div>
          <div className="text-center mt-3">
            <p className="text-xs">© 2025 株式会社PMAgent</p>
          </div>
        </div>
      </footer>
    </div>
  );
}