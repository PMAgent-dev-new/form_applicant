import type { Metadata } from 'next';
import { BASE_PATH } from '@/lib/basePath';
import CoupangStepForm from '@/app/components/coupang-form/CoupangStepForm';
import { getCoupangStep1Options } from '@/app/api/coupang/step1-options/options';

/**
 * 勤務地を選択肢マスタ(GAS)から出しているため、ビルド時に固定されると
 * マスタ更新に追随できない。1時間ごとに取り直す。
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'ロケットナウ フィールドセールスの募集｜ライドジョブ（RIDE JOB）',
  description:
    'フードデリバリー「ロケットナウ」（CP One Japan 合同会社）のフィールドセールス（飲食店への法人営業）の募集です。月給320,000円〜・未経験OK。ご応募後、30分のWeb面談または電話面談でご案内します。',
};

/**
 * クーパン（ロケットナウ）営業職LP。
 *
 * **記載内容の裏取り**（2026-08-27）
 * 給与・条件は自社サイトに公開中の求人票（jobs-feed.xml で60件確認）に基づく。
 *   - 固定残業代の内訳はクライアント回答（2026-08-27）:
 *     基本給244,850円＋固定残業代75,150円（約35時間分）＝月給320,000円。
 *     超過分は別途支給。**求人票側にはこの内訳が無いため、求人票の是正も別途必要。**
 *   - 求人票の構造化データ上の上限350,000円は**根拠の説明が無い**ため書かない
 *     （本文の記載は基本給320,000円のみ）。
 *   - **雇用形態は契約社員**（60件中53件が contract）。明示する。
 *   - 面談30分・Web/電話: 予約システム(leomeet /book/cpj)の実表示
 *
 * ⚠️ **年齢はLPに書かない**（2026-08-27 三木さん判断）。「40歳以下」の根拠に使える
 * 例外事由3号のイ（長期勤続によるキャリア形成）は**無期雇用が要件**で、主力求人が
 * 有期雇用である以上この理由は使えない。年齢の絞り込みは Meta のターゲティング
 * （18-40・Advantage+オーディエンスはOFF）とフォームの入力制限で行う。
 *
 * ⚠️ **勤務地は「配信対象の8エリア」**。フォームの選択肢マスタ(GAS)とは一致していない。
 * 愛媛はマスタに無く**現状フォームで選択できない**ため、配信ONの前にマスタへ追加が要る。
 * 条件が確認できたら §募集職種 のカードに追記する。
 */

const JOB_DETAIL = {
  name: 'フィールドセールス',
  summary:
    '飲食店さまへロケットナウの導入をご提案する営業です。未経験からのスタートを歓迎しています（業界・経験年数は不問）。',
  rows: [
    {
      label: '給与',
      value:
        '月給 320,000円 〜\n（基本給 244,850円 ＋ 固定残業代 75,150円／約35時間分）\n※約35時間を超える時間外・休日・深夜労働分は別途支給します\n入社後3ヶ月間の獲得件数に応じて、最大100万円の一時金（条件あり）',
    },
    { label: '雇用形態', value: '契約社員（正社員登用制度あり）' },
    { label: '勤務時間', value: '10:00 〜 19:00（実働8時間）' },
    { label: '休日', value: '完全週休2日制（土日祝休み）／年末年始・有給休暇あり' },
    { label: 'その他', value: '各種社会保険完備／通勤手当（上限30,000円／月）／社用PC・携帯貸与' },
  ],
} as const;

const STEPS = [
  { no: '01', title: 'このページから応募', body: '所要2〜3分。履歴書は不要です。' },
  { no: '02', title: '面談日程を選ぶ', body: '応募後の画面で、ご都合の良い日時をお選びいただけます。' },
  { no: '03', title: '30分の面談', body: 'Web面談または電話面談。募集職種の詳細と選考の進め方をご案内します。' },
] as const;

/**
 * 勤務地はフォームの選択肢マスタ（GAS）と**同じソース**から出す。
 * ここを静的に列挙すると、マスタを更新したときにフォームだけ変わってLPが黙って
 * 古くなる。さらに、LPに載っている勤務地がフォームで選べないと応募者が行き止まりになる。
 * GASが落ちた場合はフォールバックが空になるため、その時は勤務地の行ごと出さない。
 */
async function getFieldSalesAreas(): Promise<string[]> {
  const options = await getCoupangStep1Options();
  const areas = options.combinations
    .filter((c) => c.jobPosition === JOB_DETAIL.name)
    .map((c) => c.desiredLocation);
  return areas.length > 0 ? areas : options.desiredLocations;
}

export default async function CoupangPage() {
  const areas = await getFieldSalesAreas();
  const rows = [
    ...JOB_DETAIL.rows,
    ...(areas.length > 0 ? [{ label: '勤務地', value: areas.join('・') }] : []),
  ];

  return (
    // overflow-clip: ステップフォームの非アクティブなカードは absolute で重ねてあり、
    // 高さの違う分がページ下端からはみ出して「何も無いのにスクロールできる」領域を作る。
    // 旧デザインではこの領域に body::before のタクシー背景が見えていた。
    // ⚠️ overflow-hidden にしてはいけない。hidden は要素を**スクロールコンテナにする**ため、
    //    #entry へのアンカー移動が祖先ごとスクロールし、ラッパーが約380pxずれて
    //    ヒーローが二度と見られなくなる（ユーザー操作では戻せない）。
    //    clip はスクロールコンテナにならないので、はみ出しだけを消せる。
    <div className="min-h-[100dvh] overflow-clip bg-[#fff7ed]">
      {/* ヒーロー */}
      <header className="bg-[#f97316] px-4 pb-10 pt-12 text-white">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-bold tracking-wider text-white/90">
            韓国発クーパングループ
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
            ロケットナウ
            <span className="mt-1 block text-xl font-bold sm:text-2xl">
              フィールドセールスの募集
            </span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/95 sm:text-base">
            フードデリバリー「ロケットナウ」を運営する CP One Japan 合同会社の募集です。
            飲食店さまへロケットナウの導入をご提案する、フィールドセールスを募集しています。
          </p>
          <a
            href="#entry"
            className="mt-7 inline-flex w-full items-center justify-center rounded-lg bg-white px-6 py-4 text-base font-bold text-[#f97316] shadow-md transition-colors hover:bg-orange-50 sm:w-auto"
          >
            応募フォームへ進む
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-12">
        {/* 募集職種 */}
        <section className="mt-10">
          <h2 className="border-l-4 border-[#f97316] pl-3 text-xl font-bold text-gray-900">
            募集職種
          </h2>
          <div className="mt-4 rounded-xl border border-orange-100 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900">{JOB_DETAIL.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-700">{JOB_DETAIL.summary}</p>
            <dl className="mt-4 space-y-3 border-t border-gray-100 pt-4 text-sm">
              {rows.map((row) => (
                <div key={row.label} className="flex gap-3">
                  <dt className="w-20 shrink-0 font-bold text-gray-500">{row.label}</dt>
                  <dd className="whitespace-pre-line text-gray-800">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            ※求人により条件は異なります。詳細は面談時にご案内します。
          </p>
        </section>

        {/* 選考の流れ */}
        <section className="mt-10">
          <h2 className="border-l-4 border-[#f97316] pl-3 text-xl font-bold text-gray-900">
            ご応募から面談まで
          </h2>
          <ol className="mt-4 space-y-3">
            {STEPS.map((step) => (
              <li
                key={step.no}
                className="flex gap-4 rounded-xl border border-orange-100 bg-white p-4 shadow-sm"
              >
                <span className="shrink-0 text-xl font-bold text-[#f97316]">{step.no}</span>
                <div>
                  <p className="font-bold text-gray-900">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* 応募条件 */}
        <section className="mt-10">
          <h2 className="border-l-4 border-[#f97316] pl-3 text-xl font-bold text-gray-900">
            応募条件
          </h2>
          <ul className="mt-4 space-y-2 rounded-xl border border-orange-100 bg-white p-5 text-sm leading-relaxed text-gray-800 shadow-sm">
            <li>・新しい市場の開拓に意欲を持ち、成長を楽しめる方</li>
            <li>・上記いずれかの勤務地で働ける方</li>
            <li className="pt-1 text-gray-600">
              ・営業や飛び込み営業のご経験がある方は歓迎します（業界・経験年数は不問）
            </li>
          </ul>
        </section>

        {/* 応募フォーム */}
        <section id="entry" className="mt-12 scroll-mt-4">
          <h2 className="border-l-4 border-[#f97316] pl-3 text-xl font-bold text-gray-900">
            応募フォーム
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            入力は2〜3分で完了します。ご応募後、面談日程をお選びいただけます。
          </p>
          <div className="mt-4">
            <CoupangStepForm />
          </div>
        </section>
      </main>

      <footer className="bg-[#212e4a] py-6 text-white">
        <div className="mx-auto max-w-2xl px-4">
          <div className="flex flex-col items-center gap-2 text-xs sm:flex-row sm:justify-center sm:gap-8">
            <a href="https://pmagent.jp/" className="hover:underline">
              運営会社について
            </a>
            <a href={`${BASE_PATH}/privacy`} className="hover:underline">
              プライバシーポリシー
            </a>
          </div>
          <p className="mt-4 text-center text-xs leading-relaxed text-white/80">
            募集企業: CP One Japan 合同会社（ロケットナウ）
            <br />
            本募集は株式会社PM Agentの有料職業紹介事業（許可番号 13-ユ-313375）によるご案内です。
            <br />
            ご応募後は株式会社PM Agentの担当者よりご連絡します。
          </p>
          <p className="mt-1 text-center text-xs text-white/60">© 2025 株式会社PMAgent</p>
        </div>
      </footer>
    </div>
  );
}
