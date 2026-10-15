'use client';

import Image from '@/app/components/AppImage';

type FingerHintProps = {
  isVisible: boolean;
  className?: string;
  size?: number;
};

// finger.webp（145×109）の縦横比
const FINGER_ASPECT_RATIO = 109 / 145;

// 対象（入力欄・ボタン）の右端に少し重ねて縦中央に置き、左向きに指す。
// はみ出しは 12px で、カードの左右の余白（FormCard の px-6＝24px）の内側に収まる。
// 対象の親要素に relative を付け、対象の右端を親の右端にそろえて使う。
export const FINGER_HINT_RIGHT_OF_TARGET = 'absolute right-0 top-1/2 -translate-y-1/2 translate-x-3';

// ボタンの中にも置くので、要素は span（block）にする（button の中に div は置けない）
export default function FingerHint({ isVisible, className = '', size = 44 }: FingerHintProps) {
  const containerClassName = `pointer-events-none block ${className}`.trim();
  const animationClassName = `block transition-all duration-300 ease-out ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}`;

  return (
    <span className={containerClassName} aria-hidden="true">
      <span className={animationClassName}>
        {/* block: インライン画像の下にできる隙間で縦中央がずれるのを防ぐ */}
        <Image
          src="/images/finger.webp"
          width={size}
          height={Math.round(size * FINGER_ASPECT_RATIO)}
          alt=""
          className="block select-none drop-shadow-lg finger-hint-nudge"
        />
      </span>
    </span>
  );
}
