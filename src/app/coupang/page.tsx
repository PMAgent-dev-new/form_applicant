import type { Metadata } from 'next';
import { BASE_PATH } from '@/lib/basePath';
import CoupangStepForm from '@/app/components/coupang-form/CoupangStepForm';

export const metadata: Metadata = {
  title: 'ロケットナウ 営業職の募集｜ライドジョブ（RIDE JOB）',
  description:
    '韓国発スタートアップ「ロケットナウ」（CP One Japan 合同会社）の営業職（フィールドセールス／アカウントマネージャー）の募集です。ご応募後、30分のWeb面談または電話面談で仕事内容をご案内します。',
};

/**
 * クーパン（ロケットナウ）営業職LP。
 *
 * ⚠️ **記載できる事実の範囲について**（2026-08-27 時点）
 * 給与・待遇・具体的な業務内容は、クライアント確認が取れるまで**書かない**。
 * 理由: 求人ページ(ridejob.jp/job/uyl1oq5g4_7)は404で参照できず、社内に残っていた
 * 求人データは2025-11更新の死にコードだった。裏取りのない条件を出すと求人広告として
 * 不適切になるため、ここには一次確認が取れている事実だけを置いている。
 *   - 職種2種と勤務地: GASの選択肢マスタ（稼働中・フォームと同じソース）
 *   - 面談30分・Web/電話: 予約システム(leomeet /book/cpj)の実表示
 *   - 年齢18〜40歳: 応募フォームの入力条件
 * 条件が確認できたら §募集職種 のカードに追記する。
 */

const JOB_POSITIONS = [
  {
    name: 'フィールドセールス',
    summary: '飲食店さまへロケットナウの導入をご提案する、外に出る営業です。',
    areas: '北海道・宮城・埼玉・千葉・東京・神奈川・静岡・京都・大阪・広島',
  },
  {
    name: 'アカウントマネージャー',
    summary: '導入いただいた店舗さまを継続的にサポートする、社内中心の営業です。',
    areas: '東京',
  },
] as const;

const STEPS = [
  { no: '01', title: 'このページから応募', body: '所要2〜3分。履歴書は不要です。' },
  { no: '02', title: '面談日程を選ぶ', body: '応募後の画面で、ご都合の良い日時をお選びいただけます。' },
  { no: '03', title: '30分の面談', body: 'Web面談または電話面談。募集職種の詳細と選考の進め方をご案内します。' },
] as const;

export default function CoupangPage() {
  return (
    // overflow-hidden: ステップフォームの非アクティブなカードは absolute で重ねてあり、
    // 高さの違う分がページ下端からはみ出して「何も無いのにスクロールできる」領域を作る。
    // 旧デザインではこの領域に body::before のタクシー背景が見えていた。
    <div className="min-h-[100dvh] overflow-hidden bg-[#fff7ed]">
      {/* ヒーロー */}
      <header className="bg-[#f97316] px-4 pb-10 pt-12 text-white">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-bold tracking-wider text-white/90">
            韓国発スタートアップ
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
            ロケットナウ
            <span className="mt-1 block text-xl font-bold sm:text-2xl">営業職の募集</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/95 sm:text-base">
            フードデリバリー「ロケットナウ」を運営する CP One Japan 合同会社の営業職です。
            フィールドセールスとアカウントマネージャーの2職種で募集しています。
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
          <div className="mt-4 space-y-4">
            {JOB_POSITIONS.map((job) => (
              <div
                key={job.name}
                className="rounded-xl border border-orange-100 bg-white p-5 shadow-sm"
              >
                <h3 className="text-lg font-bold text-gray-900">{job.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">{job.summary}</p>
                <dl className="mt-4 border-t border-gray-100 pt-3 text-sm">
                  <div className="flex gap-3">
                    <dt className="shrink-0 font-bold text-gray-500">勤務地</dt>
                    <dd className="text-gray-800">{job.areas}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            ※給与・待遇などの詳細は、面談時にご案内します。
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
            <li>・18歳〜40歳の方（長期勤続によるキャリア形成を図るため）</li>
            <li>・上記いずれかの勤務地で働ける方</li>
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
          <p className="mt-4 text-center text-xs text-white/80">
            募集企業: CP One Japan 合同会社（ロケットナウ）
          </p>
          <p className="mt-1 text-center text-xs text-white/60">© 2025 株式会社PMAgent</p>
        </div>
      </footer>
    </div>
  );
}
