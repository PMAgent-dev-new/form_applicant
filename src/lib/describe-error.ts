/**
 * 例外をログ用の1行にする。**エラーオブジェクトを丸ごと console.error に渡さないこと。**
 *
 * V8 の JSON の SyntaxError は message 自体に入力の断片を載せる
 * （例: `Unexpected token 'a', "taro@exampl"... is not valid JSON`。2026-09-10 に Node で実測）。
 * name と message に絞っても断片は message 側に残るので、SyntaxError だけは message を出さない。
 * 応募本文の JSON が壊れていたときに、氏名・メール・電話の断片がログに載るのを防ぐ。
 *
 * undici の fetch 失敗は message が 'fetch failed' としか出ないので cause まで出す。
 *
 * 応募API と、応募後の副作用を送るライブラリで共有する（ログの書式を1か所で決めるため）。
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
