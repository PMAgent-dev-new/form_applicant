/**
 * Meta Pixel（ブラウザ側）ヘルパー。
 * base ローダーは app/layout.tsx の <script> で読み込み、ここでは標準イベント送信のみを担う。
 * CAPI（サーバー）と重複排除するため eventId を共有する。
 */

import { isUdPath } from '@/lib/ud-ad-consent';

type MetaEventName = 'ViewContent' | 'AddToCart' | 'Lead' | 'Purchase';

type MetaEventParams = {
  contentIds?: string[];
  contentName?: string;
  value?: number;
  currency?: string;
};

type FbqFn = (...args: unknown[]) => void;

function getFbq(): FbqFn | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { fbq?: FbqFn }).fbq;
}

/**
 * Meta 標準イベントをブラウザから送信する。
 * eventId を渡すと CAPI と同一イベントとして重複排除される。
 */
export function trackMeta(event: MetaEventName, params: MetaEventParams = {}, eventId?: string): void {
  if (typeof window !== 'undefined' && isUdPath(window.location.pathname)) return;
  const fbq = getFbq();
  if (!fbq) return;

  const data: Record<string, unknown> = {};
  if (params.contentIds && params.contentIds.length > 0) {
    data.content_ids = params.contentIds;
    data.content_type = 'product';
  }
  if (params.contentName) data.content_name = params.contentName;
  if (typeof params.value === 'number') data.value = params.value;
  if (params.currency) data.currency = params.currency;

  if (eventId) {
    fbq('track', event, data, { eventID: eventId });
  } else {
    fbq('track', event, data);
  }
}

/** Pixel と CAPI で共有する一意のイベントID。 */
export function genEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
