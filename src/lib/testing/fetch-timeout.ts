/**
 * タイムアウトのテスト用の fetch スタブ。**テスト専用。本番コードから import しないこと。**
 *
 * 実際に5秒待たずに、ライブラリが「タイムアウト付きの signal を fetch に渡し、
 * 打ち切られたら失敗として返す」ことを確かめるために使う。
 */
import { vi } from 'vitest';

const realAbortSignalTimeout = AbortSignal.timeout.bind(AbortSignal);

/**
 * AbortSignal.timeout を、すぐ期限が切れる signal に差し替える。
 * 戻り値のスパイで、ライブラリが指定した値（呼び出し引数）と、作られた signal（mock.results）を確かめる。
 */
export function shortenAbortSignalTimeout(ms = 20) {
  return vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realAbortSignalTimeout(ms));
}

/**
 * 相手が応答しない fetch。signal が abort されたら、その理由（TimeoutError）で reject する。
 * signal が渡されなければ別のエラーで reject し、タイムアウトが無いことにテストで気づけるようにする。
 */
export function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('fetch に signal が渡されていない'));
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
}

/**
 * ヘッダ（status）までは返し、本文の途中で止まる fetch。
 * signal が abort されると、本文の読み取りがその理由で失敗する（undici の fetch と同じ振る舞い。2026-09-10 に実測）。
 */
export function stalledBodyFetch(status: number) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
        if (!signal) {
          controller.error(new Error('fetch に signal が渡されていない'));
          return;
        }
        if (signal.aborted) {
          controller.error(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  });
}
