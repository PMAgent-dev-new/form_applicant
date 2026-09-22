import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAdImageUrl } from './resolveAdImage';

describe('resolveAdImageUrl の失敗ログ', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('通信エラーでは null を返し、エラーオブジェクトではなく1行の文字列（describeError）でログに出す', async () => {
    // エラーオブジェクトを丸ごと渡すと、スタックトレースと cause が複数行に折り返す。
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause });
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(resolveAdImageUrl('1234567890', { token: 'test-token' })).resolves.toBeNull();
    expect(warnSpy.mock.calls).toEqual([
      ['[meta] ad image resolution error:', 'TypeError: fetch failed cause=ECONNRESET'],
    ]);
  });
});
