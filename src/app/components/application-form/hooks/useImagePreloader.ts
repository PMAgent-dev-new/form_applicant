'use client';

import { useEffect, useRef } from 'react';

import { assetPath } from '@/lib/basePath';

type UseImagePreloaderParams = {
  images: string[];
  onComplete: () => void;
  enable: boolean;
};

export function useImagePreloader({ images, onComplete, enable }: UseImagePreloaderParams) {
  // onComplete はインラインで毎レンダー変わるため ref 経由で参照し、effect の依存に含めない。
  // （依存に含めると親の再レンダーごとに effect が再実行され、完了タイマーが毎回クリアされてローディングが終わらない）
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enable) return;
    if (doneRef.current) return;

    const complete = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onCompleteRef.current();
    };

    if (images.length === 0) {
      complete();
      return;
    }

    let loaded = 0;
    const handleOne = () => {
      loaded += 1;
      if (loaded >= images.length) complete();
    };

    images.forEach((src) => {
      const img = document.createElement('img');
      img.onload = handleOne;
      // 画像が見つからない場合もローディングが止まらないよう、エラーも「完了」扱いにする。
      img.onerror = handleOne;
      // basePath 配下では /public 画像が `${BASE_PATH}/...` で配信されるため前置する。
      img.src = src.startsWith('/') ? assetPath(src) : src;
    });

    // 何があっても一定時間で必ずローディングを終了させる安全網。
    //
    // 5000ms → 1200ms に短縮（2026-08-13）。根拠は次の2点のみ:
    // 1. 初手カード（JobTimingCard / MechanicQualificationCard）に画像が無い。
    //    ここで待っている画像は step2 以降のもので、最初の表示には要らない。
    // 2. そもそもプリロードは生URL（/entry/images/*.webp）を取りに行くが、
    //    実際の表示は AppImage 経由の /_next/image?url=... で別リソース。
    //    待ってもキャッシュは温まらないため、長く待つ積極的な理由が無い。
    //
    // ※ 恒久的にはゲート自体の廃止が筋（初手が画像レスなので失うものが無い）。
    //    本変更は上限を下げるだけの暫定措置。
    const fallbackTimer = setTimeout(complete, 1200);
    return () => clearTimeout(fallbackTimer);
  }, [enable, images]);
}
