'use client';

import Image from '@/app/components/AppImage';
import type { ReactNode } from 'react';

import FingerHint, { FINGER_HINT_RIGHT_OF_TARGET } from './FingerHint';

type FormExitModalProps = {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
  variant: 'default' | 'phone';
};

export default function FormExitModal({ isOpen, onConfirm, onClose, variant }: FormExitModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/60 px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-guard-title"
    >
      {variant === 'phone' ? (
        <PhoneExitContent onClose={onClose} onConfirm={onConfirm} />
      ) : (
        <DefaultExitContent onClose={onClose} onConfirm={onConfirm} />
      )}
    </div>
  );
}

function DefaultExitContent({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="w-full max-w-sm rounded-3xl bg-[#F8F8F8] px-6 py-7 shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
      <div className="flex items-start gap-4">
        <Image
          src="/images/exit-guard.webp"
          alt="ライドジョブ三浦"
          width={84}
          height={84}
          className="h-20 w-20 flex-shrink-0 rounded-full object-cover shadow-[0_8px_16px_rgba(0,0,0,0.12)]"
          priority
        />
        <div className="flex flex-col gap-3 text-left text-sm text-gray-900">
          <span id="exit-guard-title" className="text-xs font-semibold text-[#FF7500]">
            ライドジョブ三浦
          </span>
          <div className="flex flex-col gap-3">
            <SpeechBubble>いま求人をお探ししている途中です</SpeechBubble>
            <SpeechBubble>もう少しで表示されますが、見なくてもいいですか？</SpeechBubble>
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="relative inline-flex w-full items-center justify-center gap-2 overflow-visible rounded-full border-2 border-[#FF7500] bg-white px-6 py-3 text-base font-semibold text-[#FF7500] shadow-[0_6px_0_rgba(255,117,0,0.18)] transition hover:bg-[#FFF4EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF7500]"
        >
          入力に戻る
          <FingerHint isVisible size={44} className={FINGER_HINT_RIGHT_OF_TARGET} />
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="text-xs font-semibold text-gray-500 underline underline-offset-4 transition hover:text-gray-700"
        >
          それでもページを離れる
        </button>
      </div>
    </div>
  );
}

function PhoneExitContent({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="w-full max-w-sm rounded-3xl bg-white px-6 py-8 text-center shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
      <h2 id="exit-guard-title" className="text-xl font-bold leading-snug text-gray-900">
        <span className="block text-2xl">未経験からの</span>
        <span className="block text-[#FF7500] text-2xl">タクシー転職で年収UP</span>
      </h2>

      <div className="mt-4">
        <Image
          src="/images/exit-guard-phone.webp"
          alt="年収アップの事例"
          width={300}
          height={220}
          className="mx-auto h-auto w-full max-w-[260px]"
          priority
        />
      </div>

      <h1 className="mt-6 text-xl font-bold leading-relaxed text-gray-900">あなたの年収が<br/>どれだけ上がるか判明</h1>

      <div className="mt-6 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex w-full items-center justify-center rounded-full border-2 border-[#FF7500] bg-white px-6 py-3 text-base font-semibold text-[#FF7500] shadow-[0_6px_0_rgba(255,117,0,0.18)] transition hover:bg-[#FFF4EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF7500]"
        >
          入力に戻る
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="text-xs font-semibold text-gray-500 underline underline-offset-4 transition hover:text-gray-700"
        >
          入力せずに離れる
        </button>
      </div>
    </div>
  );
}

function SpeechBubble({ children }: { children: ReactNode }) {
  return (
    <div className="relative rounded-2xl bg-white px-4 py-3 text-sm font-semibold leading-relaxed text-gray-800 shadow-[0_6px_16px_rgba(0,0,0,0.08)]">
      <span
        className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rotate-45 bg-white shadow-[0_6px_16px_rgba(0,0,0,0.08)]"
        aria-hidden
      />
      {children}
    </div>
  );
}


