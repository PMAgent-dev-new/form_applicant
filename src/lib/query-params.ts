// 公開 API のクエリ値の検証。
//
// ID は src/lib/microcms.ts で `prefecture[equals]${id}` のように filters へ文字列で埋め込む。
// 検証しないと `13[or]...` のような値で filters の条件を足せてしまい、想定外の問い合わせや
// microCMS の 400（→このAPIの500）を外から起こせる。microCMS のコンテンツIDは英数字・ハイフン・
// アンダースコアなので、それ以外を含む値は通さない。

const MICROCMS_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isMicrocmsId = (value: string | null | undefined): value is string =>
  typeof value === 'string' && MICROCMS_ID.test(value);

/** カンマ区切りの ID 列。1つでも形式外なら null（部分的に通すと呼び出し側の意図と違う絞り込みになる）。 */
export const parseMicrocmsIdList = (raw: string | null, maxItems = 20): string[] | null => {
  if (!raw) return [];
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length > maxItems || !ids.every(isMicrocmsId)) return null;
  return ids;
};

/** 件数指定。数値でなければ既定値、範囲外は 1..max に丸める（microCMS の limit にそのまま渡るため）。 */
export const clampCount = (raw: string | null, fallback: number, max: number): number => {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
};
