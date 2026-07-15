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
    const fallbackTimer = setTimeout(complete, 5000);
    return () => clearTimeout(fallbackTimer);
  }, [enable, images]);
}
