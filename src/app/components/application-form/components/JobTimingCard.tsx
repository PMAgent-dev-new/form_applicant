'use client';

import FormCard from './FormCard';
import FingerHint from './FingerHint';
import type { FormData, FormErrors } from '../types';

type JobTimingCardProps = {
  selectedTiming: FormData['jobTiming'];
  errors: FormErrors;
  onSelect: (value: FormData['jobTiming']) => void;
  isActive: boolean;
  errorMessage?: string;
};

const options: Array<{
  value: FormData['jobTiming'];
  label: string;
  description?: string;
  className: string;
}> = [
  {
    value: 'asap',
    label: '決まれば早く転職したい',
    className: 'bg-[#ff702a] text-white shadow-[0_6px_0_0_rgba(255,112,42,0.4)]',
  },
  {
    value: 'no_plan',
    label: 'すぐに転職する気はない',
    className: 'bg-[#9be5ff] text-gray-900 shadow-[0_6px_0_0_rgba(155,229,255,0.5)]',
  },
  {
    value: 'browse_only',
    label: '求人だけ見たい',
    className: 'bg-[#d1d5db] text-gray-900 shadow-[0_6px_0_0_rgba(209,213,219,0.6)]',
  },
];

export default function JobTimingCard({ selectedTiming, errors, onSelect, isActive, errorMessage }: JobTimingCardProps) {
  const handleClick = (value: FormData['jobTiming']) => {
    onSelect(value);
  };

  // 選ぶと自動で次の質問へ進むので、選んだあとの「次へ」を指すヒントは置かない
  const shouldShowInitialHint = !selectedTiming;

  return (
    <FormCard isActive={isActive}>
      {/* 選択肢が3つあるので、縦の余白は画面の高さで変える。高さ 740px 未満は詰めて、
          320×568 でもモーダルの中でスクロールが出ないようにする（目安はカードの高さ 320px 以内）。
          幅 360px 未満は上の2つが2行に折り返すので、見出しを1行に収め、高さ 740px 未満ならボタンの上下と間をさらに詰める
          （max-[360px]。高さ 740px 以上ではあとに出力される py-6・gap-4 が勝つ）。
          auto-rows-fr で3つの高さをいちばん高いボタンにそろえる（2行に折り返す幅でも同じ大きさにする） */}
      <div className="mb-3 text-center [@media(min-height:740px)]:mb-5">
        <h2 className="text-lg font-bold text-gray-900 max-[360px]:text-base">転職時期は決まっていますか？</h2>
      </div>

      <div className="grid auto-rows-fr gap-3 max-[360px]:gap-2.5 [@media(min-height:740px)]:gap-4">
        {options.map((option, index) => {
          const isSelected = selectedTiming === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`relative w-full rounded-2xl px-9 py-4 text-center max-[375px]:px-10 max-[360px]:py-2.5 [@media(min-height:740px)]:py-6 transition-transform duration-150 ease-out focus:outline-none focus:ring-4 focus:ring-orange-200 ${
                option.className
              } ${isSelected ? 'ring-4 ring-[#ffb48a]' : ''}`}
              onClick={() => handleClick(option.value)}
            >
              {/* 左右の px-9 は、右端の ✓ と指（どちらも幅 32px 以内）を文字に重ねないための余白。左右同じにして文字を中央に保つ。
                  スマホ幅は text-lg にする。幅 375px 未満は text-base・px-10 にして、360px では1行に収め、2行に折り返す 320px でも指と重ならないようにする */}
              <span className="block text-lg font-bold max-[375px]:text-base sm:text-xl">{option.label}</span>
              {option.description && <span className="mt-1 block text-sm opacity-90">{option.description}</span>}
              {isSelected && (
                <span className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-[#ff702a]">
                  ✓
                </span>
              )}
              {index === 0 && (
                <FingerHint isVisible={shouldShowInitialHint} size={32} className="absolute right-0.5 top-1/2 -translate-y-1/2" />
              )}
            </button>
          );
        })}
      </div>

      {(errorMessage ?? errors.jobTiming) && <p className="mt-4 text-xs text-red-500">{errorMessage ?? errors.jobTiming}</p>}
    </FormCard>
  );
}

