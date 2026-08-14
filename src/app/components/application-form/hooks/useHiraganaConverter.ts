'use client';

import { useCallback, useRef } from 'react';

import { apiPath } from '@/lib/basePath';

/**
 * 氏名 → ふりがな変換。
 *
 * ⚠️ 以前はクライアントで kuroshiro を動かしており、kuromoji の辞書
 * （`public/dict`・約17MB）を訪問者のブラウザにダウンロードさせていた。
 * 広告クリックはほぼ初回訪問＝キャッシュ無し、アプリ内ブラウザは
 * キャッシュも分離されるため毎回発生していた。
 *
 * 変換はサーバー（`/api/hiragana`）に寄せた。クライアントの転送は
 * 数百バイトで済み、回線品質にも依存しない。
 *
 * - `convert()`: 変換する。失敗時は空文字（呼び出し側は何もしない）
 * - `warmUp()`: サーバー側の辞書初期化を先に起こしておく。
 *   コールドスタート時の初期化が重いため、氏名入力より前に叩いておくと
 *   blur 時のレスポンスが速くなる。冪等。
 */
export function useHiraganaConverter() {
  // warmUp は氏名の毎キーストロークからも呼ばれるので、実際の発射は1回に絞る。
  const warmedRef = useRef(false);

  const convert = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return '';
    try {
      const res = await fetch(apiPath('/api/hiragana'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) return '';
      const data = (await res.json()) as { hiragana?: string };
      return typeof data.hiragana === 'string' ? data.hiragana : '';
    } catch (error) {
      console.error('Failed to convert to hiragana:', error);
      return '';
    }
  }, []);

  // サーバーの辞書初期化を先に起こす。空文字を投げるだけなので変換は走らない。
  // 失敗しても握りつぶす（本番の変換時に改めて初期化される）。
  const warmUp = useCallback(() => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void fetch(apiPath('/api/hiragana'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  return { convert, warmUp };
}
