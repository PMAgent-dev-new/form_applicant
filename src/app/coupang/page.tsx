import type { Metadata } from 'next';
import { BASE_PATH } from '@/lib/basePath';
import Image from '@/app/components/AppImage';
import CoupangStepForm from '@/app/components/coupang-form/CoupangStepForm';

export const metadata: Metadata = {
  title: 'ロケットナウ求人特設フォーム｜ライドジョブ（RIDE JOB）',
  description: 'ロケットナウの募集職種・仕事内容をご説明する説明会への参加お申し込みフォームです。',
};

export default function CoupangPage() {
  return (
    <div className="relative min-h-[100dvh] bg-[#f97316]">
      <Image
        src="/images/coupang_bg.webp"
        alt="Background"
        fill
        className="object-cover"
        quality={85}
        priority
      />
      <div className="relative z-10">
        <div className="mx-auto max-w-2xl px-4 py-8">
          {/* バナー画像 */}
          <div className="mb-6">
            <Image
              src="/images/coupang_banner.webp"
              alt="ロケットナウ求人特設フォーム"
              width={640}
              height={180}
              className="w-full h-auto rounded-lg"
              priority
            />
          </div>

          {/* ステップフォーム */}
          <CoupangStepForm />

          {/* Footer */}
          <footer className="text-white py-5 mt-8 bg-[#212e4a]/95 backdrop-blur-sm rounded-lg">
            <div className="container mx-auto px-4">
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
      </div>
    </div>
  );
}
