'use client';

import { useCallback, useRef } from 'react';

import { assetPath } from '@/lib/basePath';

type KuroshiroInstance = import('kuroshiro').default;

/**
 * 氏名からふりがなを生成する（kuroshiro + kuromoji）。
 *
 * ⚠️ kuromoji の辞書は `public/dict` で **約17MB** ある。
 * 以前はこのフックの `useEffect` がマウント時に無条件で `init` していたため、
 * **ふりがな欄に触れないユーザーを含む初回訪問者全員が、ページ表示直後に17MBを
 * ダウンロード**していた。広告クリックはほぼ初回訪問＝キャッシュ無し、
 * アプリ内ブラウザはキャッシュも分離されるため毎回発生していた。
 *
 * そこで初期化を遅延させ、**氏名を入力し始めた時点**で先読みを開始する。
 * 実際の変換は氏名欄の blur で走るので、入力している間にロードが進み、
 * 体感の待ちはほぼ発生しない。
 *
 * - `warmUp()`: 初期化を開始する（冪等。何度呼んでも実体は1回）
 * - `convert()`: 変換する。未初期化なら自分で初期化を待つ（保険）
 */
/** 初期化の再試行上限。辞書が404等で恒久的に落ちる状況で、打鍵のたびに再取得しないための歯止め。 */
const MAX_INIT_ATTEMPTS = 2;

export function useHiraganaConverter() {
  // 初期化の Promise を保持する。並行呼び出しでも実体は1回に集約される。
  const initPromiseRef = useRef<Promise<KuroshiroInstance | null> | null>(null);
  const attemptsRef = useRef(0);

  const warmUp = useCallback(() => {
    if (initPromiseRef.current) return initPromiseRef.current;
    if (attemptsRef.current >= MAX_INIT_ATTEMPTS) return Promise.resolve(null);
    attemptsRef.current += 1;

    initPromiseRef.current = (async () => {
      try {
        const Kuroshiro = (await import('kuroshiro')).default;
        const KuromojiAnalyzer = (await import('kuroshiro-analyzer-kuromoji')).default;
        const kuroshiro = new Kuroshiro();
        await kuroshiro.init(new KuromojiAnalyzer({ dictPath: assetPath('/dict') }));
        return kuroshiro;
      } catch (error) {
        console.error('Failed to initialize Kuroshiro:', error);
        // 失敗を握ったままだと二度と再試行できないので、次回のために捨てる。
        initPromiseRef.current = null;
        return null;
      }
    })();

    return initPromiseRef.current;
  }, []);

  const convert = useCallback(
    async (text: string) => {
      if (!text.trim()) return '';
      const kuroshiro = await warmUp();
      if (!kuroshiro) return '';
      try {
        const converted = await kuroshiro.convert(text, { to: 'hiragana', mode: 'normal' });
        return converted.replace(/\s+/g, '');
      } catch (error) {
        console.error('Failed to convert to hiragana:', error);
        return '';
      }
    },
    [warmUp]
  );

  return { convert, warmUp };
}
