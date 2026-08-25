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
    captureAttribution(
      window.location.search,
      window.location.pathname,
      document.referrer,
      new Date().toISOString(),
      window.location.host,
    );
  }, []);

  return null;
}
