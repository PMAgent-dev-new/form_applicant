type DataLayerEvent = Record<string, unknown> & {
  event: string;
};

/**
 * dataLayer へイベントを送る。
 *
 * ⚠️ GTM は layout.tsx で `strategy="lazyOnload"` で読み込まれるため、
 * load イベント後のアイドル時まで `window.dataLayer` が存在しない。
 * 以前は `window.dataLayer` が無い場合に**黙って捨てて**いたため、
 * ハイドレーションが GTM 初期化より先に終わったセッションでは
 * `step_view` などが記録されなかった（速い端末ほど落ちやすい）。
 *
 * GTM はロード時に既存のキューを遡って処理するので、
 * 未生成なら配列を作ってから push すれば取りこぼしが消える。
 */
export function trackEvent(event: string, payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const data: DataLayerEvent = {
    event,
    ...payload,
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(data);
}

