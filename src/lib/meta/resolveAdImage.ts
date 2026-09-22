/**
 * Meta Marketing API: 広告ID(ad.id)から広告クリエイティブの画像URLを解決する。
 *
 * 流入URLに仕込んだ {{ad.id}} を受け取り、
 *   ad → creative → image_url
 * の経路でクリエイティブ画像URLを取得する。
 *
 * 注意:
 * - 返る image_url は fbcdn の署名付きURLで、取得から約4〜5日で失効する（MVP方針: そのまま保存）。
 * - 応募処理を止めないため、失敗・タイムアウト時は null を返すだけにする（呼び出し側で握りつぶす）。
 */

import { describeError } from '../describe-error';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const DEFAULT_TIMEOUT_MS = 2500;

export type ResolvedAdImage = {
  adId: string;
  creativeId: string | null;
  imageUrl: string | null;
  imageHash: string | null;
};

type GraphCreative = {
  id?: string;
  image_url?: string;
  image_hash?: string;
  object_story_spec?: {
    link_data?: { picture?: string; image_hash?: string };
    video_data?: { image_url?: string; image_hash?: string; video_id?: string };
  };
};

type GraphAdResponse = {
  creative?: GraphCreative;
  error?: { message?: string };
};

/** ad.id らしき値か（Metaの広告IDは数字のみ） */
export function isLikelyAdId(value: string | undefined | null): value is string {
  return !!value && /^\d{5,}$/.test(value.trim());
}

/**
 * ad.id から画像URLを解決する。失敗時は null。
 */
export async function resolveAdImageUrl(
  adId: string,
  options?: { timeoutMs?: number; token?: string },
): Promise<ResolvedAdImage | null> {
  const token = options?.token ?? process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.warn('[meta] META_ACCESS_TOKEN is not configured. Skipping ad image resolution.');
    return null;
  }
  if (!isLikelyAdId(adId)) {
    return null;
  }

  const params = new URLSearchParams({
    fields: 'creative{id,image_url,image_hash,object_story_spec}',
    access_token: token,
  });
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${adId}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    const data = (await resp.json()) as GraphAdResponse;

    if (!resp.ok || data.error) {
      console.warn('[meta] ad image resolution failed:', data.error?.message || resp.status);
      return null;
    }

    const c = data.creative;
    if (!c) return null;

    const oss = c.object_story_spec || {};
    const imageUrl = c.image_url || oss.video_data?.image_url || oss.link_data?.picture || null;
    const imageHash = c.image_hash || oss.video_data?.image_hash || oss.link_data?.image_hash || null;

    return {
      adId,
      creativeId: c.id ?? null,
      imageUrl,
      imageHash,
    };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      console.warn('[meta] ad image resolution timed out for adId:', adId);
    } else {
      // エラーオブジェクトを丸ごと渡さない（describeError 参照）。
      console.warn('[meta] ad image resolution error:', describeError(error));
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
