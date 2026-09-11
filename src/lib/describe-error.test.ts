import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error';

describe('describeError', () => {
  it('JSON の SyntaxError は message を出さない（入力の断片＝応募者の個人情報が載るため）', () => {
    let error: unknown;
    try {
      JSON.parse('{"fullName":TANAKA TARO}');
    } catch (e) {
      error = e;
    }
    const line = describeError(error);
    expect(line).toBe('SyntaxError: (入力の断片を含みうるため message は省略)');
    expect(line).not.toContain('TANAKA');
  });

  it('タイムアウト（AbortSignal.timeout）は name と message の1行にする', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(describeError(timeout)).toBe('TimeoutError: The operation was aborted due to timeout');
  });

  it("undici の 'fetch failed' は cause のコードまで出す", () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(describeError(new TypeError('fetch failed', { cause }))).toBe('TypeError: fetch failed cause=ECONNRESET');
  });

  it('Error 以外はそのまま文字列にする', () => {
    expect(describeError('boom')).toBe('boom');
  });
});
