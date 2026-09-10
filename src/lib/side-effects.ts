/**
 * 応募後の副作用（Lark 通知・Base 保存・メール・SMS・CAPI）を実行・記録するための共通部品。
 * 共通ルート `/api/applicants` とクーパン専用ルート `/api/coupang/applicants` の両方から使う。
 *
 * どちらのルートも副作用を非致命として Promise.allSettled に流している。各タスクが例外を記録しないと、
 * allSettled が握りつぶして成功ログも失敗ログも残らない（クーパン専用ルートで 2026-09-10 に
 * 本番の Lark 通知が無言で止まっていた。PR #79）。
 */

/**
 * Lark（IM通知 Webhook・Base 自動化 Webhook）への送信タイムアウト。
 * 既存の `src/app/api/entry-bp/route.ts` と同じ 5 秒。
 * 無いと、相手が応答しないときに Promise.allSettled が張り付いたまま関数が実行上限で落ち、
 * ログが1行も残らない。
 */
export const LARK_FETCH_TIMEOUT_MS = 5000;

/**
 * 例外をログ用の1行にする。**エラーオブジェクトを丸ごと console.error に渡さないこと。**
 *
 * V8 の JSON の SyntaxError は message 自体に入力の断片を載せる
 * （例: `Unexpected token 'a', "taro@exampl"... is not valid JSON`。2026-09-10 に Node で実測）。
 * name と message に絞っても断片は message 側に残るので、SyntaxError だけは message を出さない。
 * 応募本文の JSON が壊れていたときに、氏名・メール・電話の断片がログに載るのを防ぐ。
 *
 * undici の fetch 失敗は message が 'fetch failed' としか出ないので cause まで出す。
 */
export function describeError(e: unknown): string {
  const describe = (x: unknown): string => {
    if (!(x instanceof Error)) return String(x);
    if (x.name === 'SyntaxError') return `${x.name}: (入力の断片を含みうるため message は省略)`;
    return `${x.name}: ${x.message}`;
  };
  if (!(e instanceof Error) || !e.cause) return describe(e);
  const causeCode = (e.cause as { code?: unknown }).code;
  const causeText = causeCode === undefined || causeCode === null ? describe(e.cause) : String(causeCode);
  return `${describe(e)} cause=${causeText}`;
}

/**
 * Lark の Webhook（IM通知・Base 自動化）の応答を読む。
 * `ok` は **HTTP 200 でも body の code が非0なら false**（bot除外・トークン失効など）。200 だけ見ると、
 * 届いていないのに成功と記録される。判定式は既存の `src/app/api/entry-bp/route.ts` に揃えた
 * （code を返さない応答は HTTP ステータスだけで判定する）。
 * body は丸ごとログに出さない。送った応募データを相手が引用して返す場合に備え、code と msg に絞る。
 *
 * 本文の読み取り中にタイムアウトしたら throw する。握りつぶすと code を確かめないまま
 * `resp.ok` だけで成功扱いになる（ヘッダだけ返して本文が止まる相手で再現）。
 *
 * Base 自動化 Webhook は成功時の応答形式に一次情報が無いので、呼び出し側は `ok` ではなく
 * HTTP ステータスで失敗を判定し、code≠0 は警告に留めている（PR #79・#80）。
 */
export async function readLarkResult(resp: Response): Promise<{ ok: boolean; detail: string }> {
  const data = (await resp.json().catch((e: unknown) => {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e;
    return null;
  })) as { code?: unknown; msg?: unknown } | null;
  const code = data?.code;
  const ok = resp.ok && (typeof code === 'undefined' || code === 0);
  const msg = data?.msg === undefined ? 'n/a' : String(data.msg).slice(0, 200);
  return { ok, detail: `http=${resp.status} code=${code === undefined ? 'n/a' : String(code)} msg=${msg}` };
}

/**
 * 応募1件分の副作用の失敗を1箇所に集める。`logPrefix` はログ行の先頭（例: `[coupang]`）。
 *
 * - `trackTask(label, run)`: run の例外を必ず `console.error` に残し、label を失敗に数える。
 *   返す Promise は reject しない。run() は同期 throw しうるので Promise.resolve().then() でくるむ。
 *   直接 run().then(...) にすると同期 throw が呼び出し元の catch まで飛び、応募そのものを500で落とす。
 * - `markFailed(label)`: throw しない失敗（HTTPエラー・Lark の非0コード・ライブラリの失敗戻り値）を数える。
 *   これを入れないと、サマリ行が「失敗0件」と嘘をつく。
 * - `failures`: 失敗したラベル（重複なし・発生順）。サマリ行の `failed` に出す。
 */
export function createTaskTracker(logPrefix: string) {
  const failures: string[] = [];
  const markFailed = (label: string) => {
    if (!failures.includes(label)) failures.push(label);
  };
  const trackTask = (label: string, run: () => Promise<unknown>): Promise<void> =>
    Promise.resolve()
      .then(run)
      .then(
        () => undefined,
        (e: unknown) => {
          markFailed(label);
          console.error(`${logPrefix} ${label} threw and was swallowed: ${describeError(e)}`);
        }
      );
  return { failures: failures as readonly string[], markFailed, trackTask };
}
