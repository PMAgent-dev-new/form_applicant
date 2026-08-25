'use client';

import { useEffect } from 'react';

import { captureAttribution } from '@/lib/attribution';

/**
 * 全ページでマウントし、着地時点の流入元を Cookie（rj_attr）へ取り込む。
 *
 * 送信時にも referrer を見るフォールバックはあるが、それだけでは足りない。
 * このフォームは複数ページに分かれており、ページを跨いだ時点で
 * `document.referrer` が自ドメインに書き換わって本来の流入元が消えるため、
 * **最初の着地で捕まえて保存しておく**必要がある。
 *
 * ⚠️ `useSearchParams` は使わない。使うと Suspense 境界が必須になり、
 * 入れ忘れるとビルドが落ちる。effect はクライアントでしか走らないので
 * `window.location` を直接読めば十分で、依存も増えない。
 *
 * 詳細な設計判断（Cookie を jobmadley と共有していること、
 * 有料の帰属を動かさないこと）は attribution.ts のコメントを参照。
 */
export default function AttributionCapture() {
  useEffect(() => {
    // ⚠️ ここで例外を漏らすと、effect の未捕捉例外として React ツリーが落ちる。
    // このアプリには error.tsx / global-error.tsx が無いため Next の既定エラー画面になり、
    // **そのユーザーは応募フォームを一切使えなくなる**（原因が Cookie なのでリロードしても直らない）。
    // 流入元の計測が取れないことより、応募が1件失われることの方が桁違いに重い。
    try {
      captureAttribution(
        window.location.search,
        window.location.pathname,
        document.referrer,
        new Date().toISOString(),
        window.location.host,
      );
    } catch (e) {
      console.warn('[attribution] 流入元の記録に失敗しました（応募フローは継続します）', e);
    }
  }, []);

  return null;
}
