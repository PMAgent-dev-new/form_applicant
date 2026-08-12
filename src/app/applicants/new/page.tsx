'use client';

import { apiPath } from '@/lib/basePath';
import Image from "@/app/components/AppImage";
import Link from "next/link";
import { useEffect, useState } from "react";
import BookingEmbed from "@/app/components/BookingEmbed";
import JobCard from "@/app/components/JobCard";
import type { Job } from "@/lib/microcms";

// Extend Window interface for GTM dataLayer
declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

export default function ApplicationComplete() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [userName, setUserName] = useState<string>('');

  // Track form completion on page load
  useEffect(() => {
    if (typeof window !== 'undefined' && window.dataLayer) {
      window.dataLayer.push({
        'event': 'form_complete',
        'form_name': 'ridejob_application'
      });
    }
  }, []);

  // お名前を取得してlocalStorageから削除（プライバシー保護）
  useEffect(() => {
    const name = localStorage.getItem('ridejob_user_name');
    if (name) {
      setUserName(name);
      localStorage.removeItem('ridejob_user_name');
    }
  }, []);

  // 求人情報を取得
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const response = await fetch(apiPath('/api/jobs/random?categoryId=6&count=3'));
        if (!response.ok) {
          console.error('Failed to fetch jobs');
          setIsLoadingJobs(false);
          return;
        }

        const data = await response.json();
        setJobs(data.jobs);
      } catch (error) {
        console.error('Error fetching jobs:', error);
      } finally {
        setIsLoadingJobs(false);
      }
    };

    fetchJobs();
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex w-full max-w-[480px] flex-col bg-white">
      <header className="px-6 pb-5 pt-8">
        <div className="flex items-start justify-between gap-4">
            <Image
              src="/images/ride_logo.svg"
              alt="Ride Job Logo"
              width={132}
              height={34}
              className="h-[34px] w-auto"
            />
            <div className="text-right text-[11px] leading-relaxed text-gray-700">
              <p>未経験からのタクシー転職なら</p>
              <p className="font-semibold text-gray-900">RIDE JOB（ライドジョブ）</p>
            </div>
          </div>
      </header>

      <main className="flex flex-1 flex-col pb-12">
        <section className="mt-6">
          <div className="text-center">
            <p className="mt-6 text-2xl font-bold leading-relaxed" style={{ color: '#2205D9' }}>
              RIDE JOBに問合せいただき
              <br />
              誠にありがとうございました！
            </p>
            <p className="mt-6 text-lg leading-relaxed font-bold text-gray-700">
              担当者より、お電話またはオンラインにて
              <br />
              求人をご案内させていただきます。
              <br />
              今しばらくお待ちください。
            </p>
          </div>
        </section>

        <div className="mt-6 flex justify-center">
          <Image
            src="/images/thanks-banner.webp"
            alt="転職サポートのご案内バナー"
            width={680}
            height={227}
            priority
            className="h-auto w-full"
          />
        </div>

        <section className="mt-12">
          <div className="flex items-center pl-2">
            <span className="mr-2 block h-6 w-1 rounded bg-[#2205D9]"></span>
            <h2 className="text-xl font-semibold text-gray-900">すぐに求人情報がほしい方</h2>
          </div>
          <div className="px-4">
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              高年収の求人から採用枠が埋まります。少しでも早く知りたい方は、こちらから面談日程のご予約ください。
            </p>
            <div className="mt-6">
              <BookingEmbed slug="ride" height={1100} />
            </div>
          </div>
        </section>

        <section className="mt-12">
          <div className="flex items-center pl-2">
            <span className="mr-2 block h-6 w-1 rounded bg-[#2205D9]"></span>
            <h2 className="text-xl font-semibold text-gray-900">LINEでのご連絡を希望される方</h2>
          </div>
          <div className="px-4">
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              LINEからもあなたにぴったりの求人をご紹介できます。
            </p>
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              ハローワークには掲載されていない非公開求人をLINE限定で案内しています。
            </p>
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              下のボタンをタップして、友だち追加からご連絡してください。
            </p>
          </div>

          <div className="mt-4">
            <Link
              href="https://lin.ee/4bLPZ5w"
              className="block"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Image
                src="/images/line-section.webp"
                alt="LINE公式アカウント登録バナー"
                width={750}
                height={516}
                className="h-auto w-full"
              />
            </Link>
          </div>
        </section>

        <section className="mt-12">
          <div className="flex items-center pl-2">
            <span className="mr-2 block h-6 w-1 rounded bg-[#2205D9]"></span>
            <h2 className="text-xl font-semibold text-gray-900">RIDE JOBが大切にしていること</h2>
          </div>
          <div className="px-4">
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              私たちはおもてなしの心あふれるサポートを通して、求職者様の感動を作り出す転職支援をモットーにしています。
            </p>
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              日本全国の移動を作り出すことを目指して、タクシー業界に特化した転職エージェント事業を行っています。
            </p>      
          </div>
          <div className="mt-6 overflow-hidden rounded-2xl border border-[#00A0E9] shadow-[0_8px_20px_rgba(0,160,233,0.25)]">
            <div className="relative h-0 w-full pb-[56.25%]">
              <iframe
                src="https://www.youtube.com/embed/knB0b7Mq_KA?start=1101"
                title="RIDE JOB紹介動画"
                className="absolute left-0 top-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </section>

        <section className="mt-12">
          <div className="bg-[#9CCAF5] p-4">
            <div className="rounded-xl bg-white px-6 py-8 shadow-[0_10px_25px_rgba(34,5,217,0.12)]">
              <div className="text-center">
                <p className="text-xl font-semibold text-[#2205D9]">RIDE JOBで転職した人の声</p>
                <div className="mx-auto mt-2 h-0.5 w-10 rounded bg-[#2205D9]"></div>
              </div>

              <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-gray-900">
                <p>
                  転職エージェントの利用は初めてでしたが、心強いフォローのおかげで安心して転職活動を進められました。
                </p>
                <p>
                  家族とも「以前よりずっと良い環境になった」と話しています。担当者の斉田さんには本当に感謝しています。
                </p>
                <p>
                  タクシー運転手は自分の頑張り次第で売上につながる仕事なので、やりがいを感じています。
                </p>
                <p>
                  一緒に働いている同僚も親切で、安心して働ける環境に入社できてよかったです。
                </p>
              </div>

              <div className="mt-6 border-t border-dotted border-[#7AA7FF] pt-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">Kさん</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">50代</p>
                    <div className="mt-3 inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="rounded border border-[#2205D9] px-2 py-0.5 text-xs font-semibold text-[#2205D9]">
                        前職
                      </span>
                      <span className="text-sm text-gray-700">トラックドライバー</span>
                    </div>
                  </div>
                  <div className="flex h-24 w-24 items-center justify-center">
                    <Image
                      src="/images/Profile Image.png"
                      alt="転職者のアイコン"
                      width={80}
                      height={80}
                      className="h-20 w-20"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <div className="flex items-center pl-2">
            <span className="mr-2 block h-6 w-1 rounded bg-[#2205D9]"></span>
            <h2 className="text-xl font-semibold text-gray-900">RIDE JOB公式サイトで求人を探す</h2>
          </div>
          <div className="px-4">
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              地域・職種を選んで求人検索のできる公式サイトをご用意しました。
            </p>
            <p className="mt-4 text-lg leading-relaxed text-gray-900">
              気になる求人がありましたら、ご連絡の際にお伝えください。
            </p>
          </div>
          <div className="mt-6 px-2">
            <Link
              href="https://ridejob.jp/"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-2xl bg-[#2205D9] py-4 text-center text-lg font-semibold text-white shadow-[0_6px_0_rgba(0,0,0,0.15)] transition-transform hover:translate-y-[1px]"
            >
              公式サイト
            </Link>
          </div>
        </section>

        {/* 求人カード表示 */}
        {!isLoadingJobs && jobs.length > 0 && (
          <section className="mt-12 px-4">
            <div className="mb-4 flex items-center pl-2">
              <span className="mr-2 block h-6 w-1 rounded bg-[#2205D9]"></span>
              <h2 className="text-xl font-semibold text-gray-900">
                {userName ? `${userName}さんへのおすすめの限定求人` : 'あなたにおすすめの限定求人'}
              </h2>
            </div>
            <div className="px-2 text-sm leading-relaxed text-gray-700">
              <p className="mt-6">
                {new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })}現在、タクシー求人への問合せが殺到しています。
              </p>
              <p className="mt-2">採用予定人数が埋まり次第、掲載されている求人の募集が終わっている場合があります。</p>
              <p className="mt-2">求人の募集状況については、弊社へお問い合わせください。</p>
            </div>
            <div className="space-y-4 mt-6">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="mt-16 bg-[#CDE6FF] px-6 py-12 text-center text-sm text-gray-800">
        <div className="flex flex-col items-center gap-6">
          <Image
            src="/images/ride_logo.svg"
            alt="RIDE JOB ロゴ"
            width={160}
            height={40}
            className="h-auto w-[160px]"
            priority
          />
          <nav className="flex flex-col gap-3 text-base font-medium">
            <Link href="https://pmagent.jp/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
              運営会社について
            </Link>
            <Link href="/privacy" className="hover:opacity-80">
              プライバシーポリシー
            </Link>
          </nav>
          <p className="text-xs">© 2025 株式会社PMAgent</p>
        </div>
      </footer>
      </div>
    </div>
  );
}
