'use client';

import { useCallback, useRef } from 'react';

import { apiPath } from '@/lib/basePath';
import { trackEvent } from '../utils/trackEvent';

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
 * ⚠️ この機能の失敗は **UIに何も出ない**（ふりがな欄が空のままになるだけで、
 * ユーザーは手入力で先へ進める）。放置すると壊れたことに誰も気づけないため、
 * 失敗時は必ず `hiragana_convert_failed` を計測に送る。
 *
 * - `convert()`: 変換する。失敗時は空文字（呼び出し側は何もしない）
 * - `warmUp()`: サーバー側の辞書初期化を先に起こす。冪等（実発射は1回）
 */

/** 変換失敗の理由。GA4で内訳を見るために区別する。 */
type FailureReason =
  /** fetch自体が失敗（オフライン・DNS・CORS等） */
  | 'network'
  /** サーバーが2xx以外を返した（500・404・レート制限など） */
  | 'http_error'
  /** 2xxだがJSONとして読めない */
  | 'invalid_response'
  /** サーバー側の辞書初期化に失敗している。最も深刻 */
  | 'dict_unavailable'
  /** 辞書は正常だが変換が例外で落ちた。要調査 */
  | 'convert_error'
  /**
   * 200・形式も正しいのに、理由も無くふりがなが空。
   * ⚠️ kuroshiro は未知トークン（記号・英字・異体字）の表層をそのまま返すため、
   * 非空の入力でここに来ることは実質無い。**出たらそれ自体が異常**
   * （スキーマ変更・中間装置による応答書き換え等）。
   */
  | 'empty_result';

export function useHiraganaConverter() {
  // warmUp は氏名の毎キーストロークからも呼ばれるので、実際の発射は1回に絞る。
  const warmedRef = useRef(false);
  // 同一セッションで何度も同じ失敗を送らない（GA4のイベント数を膨らませない）。
  const reportedRef = useRef<Set<FailureReason>>(new Set());

  const reportFailure = useCallback((reason: FailureReason, status?: number) => {
    if (reportedRef.current.has(reason)) return;
    reportedRef.current.add(reason);
    trackEvent('hiragana_convert_failed', {
      failure_reason: reason,
      ...(status === undefined ? {} : { http_status: status }),
    });
  }, []);

  const convert = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return '';

      let res: Response;
      try {
        res = await fetch(apiPath('/api/hiragana'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed }),
        });
      } catch (error) {
        console.error('Failed to reach hiragana API:', error);
        reportFailure('network');
        return '';
      }

      if (!res.ok) {
        console.error('Hiragana API returned an error:', res.status);
        reportFailure('http_error', res.status);
        return '';
      }

      let body: { hiragana?: unknown; reason?: unknown };
      try {
        body = (await res.json()) as { hiragana?: unknown; reason?: unknown };
      } catch (error) {
        console.error('Failed to parse hiragana response:', error);
        reportFailure('invalid_response');
        return '';
      }

      const { hiragana, reason } = body;

      // フィールドが無い・型が違うのは「形式不正」であって空結果ではない
      if (typeof hiragana !== 'string') {
        reportFailure('invalid_response');
        return '';
      }

      if (!hiragana) {
        reportFailure(
          reason === 'dict-unavailable'
            ? 'dict_unavailable'
            : reason === 'convert-error'
              ? 'convert_error'
              : 'empty_result'
        );
        return '';
      }

      return hiragana;
    },
    [reportFailure]
  );

  // サーバーの辞書初期化を先に起こす。空文字を投げるだけなので変換は走らない。
  // 失敗しても握りつぶす（本番の変換時に改めて初期化され、そこで計測される）。
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
