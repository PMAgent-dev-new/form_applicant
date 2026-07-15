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

type EnvGroup = { name: string; anyOf: string[] };

const REQUIRED_ENV_GROUPS: EnvGroup[] = [
  // 応募通知(テキスト) — これが無いと route.ts は 500 を返し応募が1件も記録されない
  { name: 'lark_notify', anyOf: ['LARK_WEBHOOK_URL', 'LARK_WEBHOOK_URL_TEST'] },
  // 応募レコード保存(Base) — 応募データの保存先
  {
    name: 'lark_base',
    anyOf: ['LARK_BASE_WEBHOOK_URL', 'LARK_BASE_WEBHOOK_URL_PROD', 'LARK_BASE_WEBHOOK_URL_TEST'],
  },
];

function isSet(key: string): boolean {
  return (process.env[key] ?? '').trim().length > 0;
}

export function findMissingEnvGroups(groups: EnvGroup[] = REQUIRED_ENV_GROUPS): string[] {
  return groups.filter((g) => !g.anyOf.some(isSet)).map((g) => g.name);
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
