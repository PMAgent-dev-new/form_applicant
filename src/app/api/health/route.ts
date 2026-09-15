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
  // 応募レコード保存(Base) — 応募データの保存先
  {
    name: 'lark_base',
    anyOf: ['LARK_BASE_WEBHOOK_URL', 'LARK_BASE_WEBHOOK_URL_PROD', 'LARK_BASE_WEBHOOK_URL_TEST'],
  },
  // LIFT JOB（クーパン）は共通経路と別のWebhookを使う。共通側だけの検査では
  // LIFT JOBのみ無言で切れても /api/health が ready のままになるため、別ゲートにする。
  {
    name: 'lark_liftjob_notify',
    anyOf: ['LARK_WEBHOOK_URL_COUPANG_PROD', 'LARK_WEBHOOK_URL_COUPANG'],
    notifyOnly: true,
  },
  // LIFT JOBはWebhook受理だけでなく、submission_idによる直接upsertを正本にする。
  { name: 'lark_liftjob_app_id', anyOf: ['APP_ID_LIFTJOB'] },
  { name: 'lark_liftjob_app_secret', anyOf: ['APP_SECRET_LIFTJOB'] },
  { name: 'lark_liftjob_app_token', anyOf: ['APP_TOKEN_LIFTJOB'] },
  { name: 'lark_liftjob_table', anyOf: ['LARK_BASE_TABLE_ID_LIFTJOB'] },
  // ChatGPT広告の成果返却。opprefがあるときだけ使用し、Advanced Matchingは別途OFFを維持する。
  { name: 'openai_ads_pixel', anyOf: ['OPENAI_ADS_PIXEL_ID'] },
  { name: 'openai_ads_capi_key', anyOf: ['OPENAI_ADS_CAPI_KEY'] },
];

function isSet(key: string): boolean {
  return (process.env[key] ?? '').trim().length > 0;
}

export function findMissingEnvGroups(
  groups: EnvGroup[] = REQUIRED_ENV_GROUPS,
  baseOnly = process.env.LARK_SEND_BASE_ONLY === 'true',
): string[] {
  return groups
    .filter((g) => !(baseOnly && g.notifyOnly))
    .filter((g) => !g.anyOf.some(isSet))
    .map((g) => g.name);
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
  return NextResponse.json({ status: 'ready' }, { status: 200 });
}
