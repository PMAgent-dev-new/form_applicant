'use client';

import { BASE_PATH } from '@/lib/basePath';
import { useEffect } from "react";
import BookingEmbed from "@/app/components/BookingEmbed";

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

export default function CoupangApplicationComplete() {
  const currentMonth = new Date().toLocaleDateString('ja-JP', { month: 'long' });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.dataLayer) {
      window.dataLayer.push({
        event: 'form_complete',
        form_name: 'coupang_rocketnow_application'
      });
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 bg-[#f1f9fa] min-h-screen">
      {/* Header Section */}
      <div className="text-center pt-8 pb-4">
        <h1 className="text-2xl font-bold text-[#ff6b35] leading-relaxed">
          この度はお申込みいただき<br />ありがとうございました！
        </h1>
        <p className="mt-3 text-lg text-gray-700 leading-relaxed">
          担当者より、お電話またはオンラインにて求人詳細をご案内します。
        </p>
      </div>

      {/* eeasy Reservation Section */}
      <div className="bg-white rounded-lg p-6 shadow-md mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4 border-l-4 border-[#ff6b35] pl-3">
          【重要】面談予約はお早めに
        </h2>
        <div className="text-base text-gray-700 space-y-2 mb-6">
          <p>{currentMonth}から求人の問い合わせが急増しており、ご希望日時に面談枠をご用意できないことがあります。</p>
          <p>空き枠があるうちに、以下より日程をご予約ください。</p>
        </div>
        <BookingEmbed slug="cpj" />
      </div>

      {/* Footer */}
      <footer className="text-white py-5 mt-8 bg-[#212e4a]">
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
  );
}
