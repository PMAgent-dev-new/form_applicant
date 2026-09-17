import { NextRequest, NextResponse } from 'next/server';

/**
 * デプロイ後の合成チェック用ヘルスエンドポイント。
 *
 * 二段構え:
 * - トークン無し(または不一致): 生存確認のみ。200 {status:'ok'} を返し、設定内容は一切漏らさない。
 *   公開エンドポイントなので、どのenvが欠けているか等の内部情報は無認証では出さない。
 * - 正しいトークン(x-health-token が env HEALTH_CHECK_TOKEN と一致): レディネスを返す。
 *   応募が成立するために不可欠な env グループが揃っていれば 200 {status:'ready'}、
 *   欠けていれば 503 {status:'degraded', missing:[...]}。
 *
 * 「必須」の定義: 応募データが Lark に届くための2系統のみ。
 * メール/SMS/Meta CAPI は未設定なら送信側で自動スキップされる付加機能なので必須に含めない。
 */

export const dynamic = 'force-dynamic';

type EnvGroup = { name: string; anyOf: string[]; notifyOnly?: boolean };

const REQUIRED_ENV_GROUPS: EnvGroup[] = [
  // 応募通知(テキスト) — これが無いと route.ts は 500 を返し応募が1件も記録されない
  {
    name: 'lark_notify',
    anyOf: ['LARK_WEBHOOK_URL', 'LARK_WEBHOOK_URL_TEST'],
    notifyOnly: true,
  },
  { name: 'lark_ridejob_chat', anyOf: ['LARK_SUBMIT_CHAT_ID_RIDEJOB'], notifyOnly: true },
  { name: 'lark_mechanic_chat', anyOf: ['LARK_SUBMIT_CHAT_ID_MECHANIC'], notifyOnly: true },
  // 応募レコード保存(Base) — 応募データの保存先
  {
    name: 'lark_base',
    anyOf: ['LARK_BASE_WEBHOOK_URL', 'LARK_BASE_WEBHOOK_URL_PROD', 'LARK_BASE_WEBHOOK_URL_TEST'],
  },
  // カタログ求人帰属はWebhookの既存マッピングには存在しないため、RIDE JOB／整備士とも
  // Bitable APIの直接書き込み資格情報を必須にする。欠落時のWebhook縮退をreadyにしない。
  { name: 'lark_ridejob_app_id', anyOf: ['APP_ID_RIDEJOB'] },
  { name: 'lark_ridejob_app_secret', anyOf: ['APP_SECRET_RIDEJOB'] },
  { name: 'lark_ridejob_app_token', anyOf: ['APP_TOKEN_RIDEJOB'] },
  { name: 'lark_mechanic_app_id', anyOf: ['APP_ID_MECHANIC'] },
  { name: 'lark_mechanic_app_secret', anyOf: ['APP_SECRET_MECHANIC'] },
  { name: 'lark_mechanic_app_token', anyOf: ['APP_TOKEN_MECHANIC'] },
  // LIFT JOB（クーパン）は共通経路と別のWebhookを使う。共通側だけの検査では
  // LIFT JOBのみ無言で切れても /api/health が ready のままになるため、別ゲートにする。
  {
    name: 'lark_liftjob_notify',
    anyOf: ['LARK_WEBHOOK_URL_COUPANG_PROD', 'LARK_WEBHOOK_URL_COUPANG'],
    notifyOnly: true,
  },
  // LIFT JOBは専用routeがsubmission_idによる直接upsertを正本にしているため、
  // 共通のRIDE JOB／整備士向け資格情報を追加しても既存ゲートを外さない。
  { name: 'lark_liftjob_app_id', anyOf: ['APP_ID_LIFTJOB'] },
  { name: 'lark_liftjob_app_secret', anyOf: ['APP_SECRET_LIFTJOB'] },
  { name: 'lark_liftjob_app_token', anyOf: ['APP_TOKEN_LIFTJOB'] },
  { name: 'lark_liftjob_table', anyOf: ['LARK_BASE_TABLE_ID_LIFTJOB'] },
];

function isSet(key: string): boolean {
  return (process.env[key] ?? '').trim().length > 0;
}

export function findMissingEnvGroups(
  groups: EnvGroup[] = REQUIRED_ENV_GROUPS,
  baseOnly = process.env.LARK_SEND_BASE_ONLY === 'true',
): string[] {
  const missing = groups
    .filter((g) => !(baseOnly && g.notifyOnly))
    .filter((g) => !g.anyOf.some(isSet))
    .map((g) => g.name);

  // ChatGPT広告は、OpenAIへ直接送れる資格情報一式、または資格情報を持つ
  // ridejob-entryへの内部relay一式のどちらかが揃っていればよい。
  const hasDirectOpenAi = isSet('OPENAI_ADS_PIXEL_ID') && isSet('OPENAI_ADS_CAPI_KEY');
  const hasOpenAiRelay = isSet('OPENAI_ADS_RELAY_URL') && isSet('OPENAI_ADS_RELAY_TOKEN');
  if (!hasDirectOpenAi && !hasOpenAiRelay) missing.push('openai_ads_delivery');
  // 直接資格情報を持つprojectはrelay受信側でもある。認証secretが無い状態をreadyにしない。
  if (hasDirectOpenAi && !isSet('OPENAI_ADS_RELAY_TOKEN')) missing.push('openai_ads_relay_auth');
  return missing;
}

async function relayIsReady(): Promise<boolean> {
  const url = process.env.OPENAI_ADS_RELAY_URL ?? '';
  const token = process.env.OPENAI_ADS_RELAY_TOKEN ?? '';
  if (!url || !token) return false;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-openai-relay-token': token },
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    return res.status === 200 && body.status === 'ready';
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const token = process.env.HEALTH_CHECK_TOKEN;
  const provided = request.headers.get('x-health-token');
  const authorized = Boolean(token) && provided === token;

  if (!authorized) {
    // 無認証: 生存確認のみ。設定詳細は返さない。
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  const missing = findMissingEnvGroups();
  if (missing.length > 0) {
    return NextResponse.json({ status: 'degraded', missing }, { status: 503 });
  }
  const usesRelay = !isSet('OPENAI_ADS_PIXEL_ID') || !isSet('OPENAI_ADS_CAPI_KEY');
  if (usesRelay && !(await relayIsReady())) {
    return NextResponse.json(
      { status: 'degraded', missing: ['openai_ads_relay_upstream'] },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: 'ready' }, { status: 200 });
}
