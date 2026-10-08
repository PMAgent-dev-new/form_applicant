/** Lark の Webhook（カスタムボット・AnyCross）が返す本文。 */
export type LarkWebhookResult = {
  code?: number | string;
  msg?: string;
  StatusCode?: number | string;
  StatusMessage?: string;
};

const isZeroCode = (value: number | string | undefined): boolean =>
  typeof value === 'number'
    ? value === 0
    : typeof value === 'string' && value.trim() !== '' && Number(value) === 0;

const isNonZeroCode = (value: number | string | undefined): boolean =>
  typeof value === 'number'
    ? value !== 0
    : typeof value === 'string' && value.trim() !== '' && Number(value) !== 0;

/**
 * Lark Bot / AnyCross は HTTP 200 でも本文で失敗を返すため、明示的な成功コードまで確認する。
 * 空本文・非JSON・成功コードの欠落は成功とみなさない。
 */
export const isLarkWebhookAccepted = (result: LarkWebhookResult | null | undefined): boolean =>
  Boolean(result)
  && (isZeroCode(result?.code) || isZeroCode(result?.StatusCode))
  && !isNonZeroCode(result?.code)
  && !isNonZeroCode(result?.StatusCode);
