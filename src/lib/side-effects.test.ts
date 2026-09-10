import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskTracker, describeError, readLarkResult } from './side-effects';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('describeError', () => {
  it('SyntaxError は message を出さない（V8 は JSON の入力の断片を message に載せる）', () => {
    // 処理系の文言に依存しないよう、断片入りの SyntaxError をこちらで作る。
    const line = describeError(new SyntaxError(`Unexpected token 'a', "taro@exampl"... is not valid JSON`));
    expect(line).toContain('SyntaxError');
    expect(line).not.toContain('taro@exampl');
  });

  it('cause が SyntaxError でも message を出さない', () => {
    const line = describeError(new Error('wrapped', { cause: new SyntaxError('"taro@exampl"... is not valid JSON') }));
    expect(line).not.toContain('taro@exampl');
  });

  it('undici の fetch failed には cause の code（ECONNRESET 等）を添える', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(describeError(new TypeError('fetch failed', { cause }))).toBe('TypeError: fetch failed cause=ECONNRESET');
  });

  it('Error でない値は文字列にする', () => {
    expect(describeError('boom')).toBe('boom');
  });
});

describe('readLarkResult', () => {
  it('HTTP 200 でも code が 0 でなければ失敗（bot除外・トークン失効など）', async () => {
    expect(await readLarkResult(jsonResponse({ code: 19001, msg: 'bot not in chat' }))).toEqual({
      ok: false,
      detail: 'http=200 code=19001 msg=bot not in chat',
    });
    expect((await readLarkResult(jsonResponse({ code: 0, msg: 'success' }))).ok).toBe(true);
  });

  it('code を返さない応答は HTTP ステータスだけで判定する', async () => {
    expect((await readLarkResult(new Response('ok', { status: 200 }))).ok).toBe(true);
    expect((await readLarkResult(new Response('Bad Gateway', { status: 502 }))).ok).toBe(false);
  });

  it('ログ用の detail には code と msg だけを出す（相手が応募データを引用して返しても載せない）', async () => {
    const r = await readLarkResult(
      jsonResponse({ code: 1254302, msg: 'permission denied', data: { full_name: '田中 太郎' } }, 403),
    );
    expect(r.detail).toBe('http=403 code=1254302 msg=permission denied');
  });

  it('本文の読み取り中にタイムアウトしたら throw する（握りつぶすと HTTP 200 だけで成功扱いになる）', async () => {
    const stalled = new ReadableStream({
      start(controller) {
        controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      },
    });
    await expect(readLarkResult(new Response(stalled, { status: 200 }))).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });
});

describe('createTaskTracker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('同期 throw でも reject せず、失敗として数えてログに残す', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { failures, trackTask } = createTaskTracker('[test]');

    await expect(
      trackTask('sync-throw', () => {
        throw new TypeError('boom');
      }),
    ).resolves.toBeUndefined();
    expect(failures).toEqual(['sync-throw']);
    expect(errorSpy).toHaveBeenCalledWith('[test] sync-throw threw and was swallowed: TypeError: boom');
  });

  it('成功したタスクは数えず、markFailed は同じラベルを重複させない', async () => {
    const { failures, markFailed, trackTask } = createTaskTracker('[test]');

    await trackTask('ok', async () => 'done');
    markFailed('lark-notification');
    markFailed('lark-notification');
    expect(failures).toEqual(['lark-notification']);
  });
});
