import type { Metadata } from 'next';
import { BASE_PATH } from '@/lib/basePath';
import Image from '@/app/components/AppImage';
import CoupangStepForm from '@/app/components/coupang-form/CoupangStepForm';

export const metadata: Metadata = {
  title: 'ロケットナウ 求人応募フォーム｜ライドジョブ（RIDE JOB）',
  description:
    'フードデリバリー「ロケットナウ」（CP One Japan 合同会社）フィールドセールスの応募フォームです。ご応募後、Web面談または電話面談でご案内します。',
};

/**
 * クーパン（ロケットナウ）応募フォームLP。
 *
 * **元のデザイン（背景イラスト＋バナー＋フォーム）を踏襲した、フォームだけの構成**
 * （2026-08-28 三木さん指示）。一時期は募集職種・条件・選考の流れを載せていたが、
 * 情報量が多く分かりにくいとの判断で撤去した。条件の提示は広告クリエイティブと
 * 応募後の面談で行う。
 *
 * 背景 `coupang_bg_blue.webp` は元の `coupang_bg.webp`（オレンジ地＋ロケット・料理の
 * イラスト）の**地色だけを青(#1d4ed8)に差し替えたもの**。イラストはそのまま。
 * 元ファイルは他で参照していないが、比較用に残してある。
 *
 * 生成方法: `magick coupang_bg.webp -fuzz 8% -fill "#1d4ed8" -opaque "srgb(253,105,21)"`
 * イラスト境界にアンチエイリアス由来の暖色が1〜2px残るが、**これ以上詰めてはいけない**。
 * fuzz を20%まで上げる／フラッドフィル＋膨張でマスクを広げる、はどちらも試したが、
 * ロケットの赤いフィンが欠け、本体に青い斑点が入るなど**イラストが壊れた**。
 *
 * ⚠️ 条件を再びLPに載せるときは、給与に**固定残業代の内訳**（金額・充当時間数・
 * 超過分の別途支給）が必要になる。詳細は Drive「クーパンLP」の実行計画を参照。
 *
 * ⚠️ **配信ON前の未解決事項**: 配信対象8エリアのうち**愛媛が選択肢マスタ(GAS)に無い**。
 * このまま愛媛へ配信すると、愛媛の応募者はフォームで勤務地を選べず応募できない。
 * マスタへの追加が必要（シートの所在が未特定・矢野さんへ確認中）。
 */
export default function CoupangPage() {
  return (
    <div className="relative min-h-[100dvh] overflow-clip bg-[#1d4ed8]">
      <Image
        src="/images/coupang_bg_blue.webp"
        alt=""
        fill
        className="object-cover"
        priority
      />
      <div className="relative z-10">
        <div className="mx-auto max-w-2xl px-4 py-8">
          {/* バナー画像 */}
          <div className="mb-6">
            <Image
              src="/images/coupang_banner.webp"
              alt="ロケットナウ求人特設フォーム"
              width={864}
              height={488}
              className="h-auto w-full rounded-lg"
              priority
            />
          </div>

          {/* ステップフォーム */}
          <CoupangStepForm />

          {/* Footer */}
          <footer className="mt-8 rounded-lg bg-[#1e3a8a]/95 py-5 text-white backdrop-blur-sm">
            <div className="container mx-auto px-4">
              <div className="mb-3 flex flex-col items-center justify-around space-y-2 text-center text-xs md:flex-row md:space-y-0 md:text-left">
                <a href="https://pmagent.jp/" className="text-white hover:underline">
                  運営会社について
                </a>
                <a href={`${BASE_PATH}/privacy`} className="text-white hover:underline">
                  プライバシーポリシー
                </a>
              </div>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-white/80">
                募集企業: CP One Japan 合同会社（ロケットナウ）
                <br />
                本募集は株式会社PM Agentの有料職業紹介事業（許可番号 13-ユ-313375）によるご案内です。
                <br />
                ご応募後は株式会社PM Agentの担当者よりご連絡します。
              </p>
              <p className="mt-2 text-center text-xs text-white/60">© 2025 株式会社PMAgent</p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
