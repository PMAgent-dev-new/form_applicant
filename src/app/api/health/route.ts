import { NextRequest, NextResponse } from 'next/server';

import { checkLarkAuth, type LarkProfile } from '@/lib/larkBase';

/**
 * デプロイ後の合成チェック用ヘルスエンドポイント。
 *
 * 二段構え:
 * - トークン無し(または不一致): 生存確認のみ。200 {status:'ok'} を返し、設定内容は一切漏らさない。
 *   公開エンドポイントなので、どのenvが欠けているか等の内部情報は無認証では出さない。
 * - 正しいトークン(x-health-token が env HEALTH_CHECK_TOKEN と一致): レディネスを返す。
 *   env が揃い資格情報も実際に通れば 200 {status:'ready', deep:true}。
 *   問題があれば 503 {status:'degraded', missing?:[...], unreachable?:[...]}。
 *   **両方あれば両方載る**（env の不足が資格情報の破損を隠さない。2026-09-24 に修正。
 *   それまでは missing があるとそこで返り、unreachable が付かなかった）。
 *
 * 「必須」の定義: 応募データが Lark に届くための2系統のみ。
 * メール/SMS/Meta CAPI は未設定なら送信側で自動スキップされる付加機能なので必須に含めない。
 *
 * ## env の有無だけでは足りない（2026-09-24 追加）
 *
 * 2026-09-17〜24 の障害では env は全部揃っていて、**中身が壊れていた**
 * （アプリ資格情報の失効と LARK_DOMAIN のスキーム規約違反）。
 * env の有無しか見ていなかったこのエンドポイントは、応募が1件も通らない7日間、
 * ready を返し続けた。「設定を配置した」は「読まれて効いている」の証明ではない（§4）。
 *
 * そこで認証付きの経路では、3プロファイルの tenant_access_token を**実際に取得**して
 * 資格情報が通ることを確かめる。`?deep=0` で省略できる（省略した応答には
 * deep:false が入るので、省略したことが応答から分かる）。
 */

export const dynamic = 'force-dynamic';
// relay チェック(最大5秒)が終わってから deep チェック(最大5秒)が走るので、コールド
// スタートを足すと既定の実行上限(10秒)に触れて 504 になり得る。504 は guard から見ると
// unhealthy と同じなので、上限を明示して「本当に壊れている」とだけ区別する。
export const maxDuration = 20;

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
  // 退避先(Supabase) — Base にも通知にも残せなかった応募を拾う最後の受け皿。
  // 未設定でも応募自体は通るが、そのとき「Base にあるのに通知だけ無い」応募が
  // どこにも残らず静かに消える。設定漏れを ready のままにしない（§4）。
  { name: 'submission_vault_url', anyOf: ['SUBMISSION_VAULT_URL'] },
  { name: 'submission_vault_key', anyOf: ['SUBMISSION_VAULT_SERVICE_KEY'] },
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

  // env の不足と資格情報の破損は別の障害。**片方が他方を隠してはいけない。**
  // 2026-09-24 まで missing があるとそこで返していたため、SUBMISSION_VAULT_* が未設定の
  // あいだは資格情報が壊れても unreachable が付かず、死活監視からは「env が足りないだけ」に
  // 見えていた（監視の中核が無効になっていた）。両方見て、見つかったものを全部返す。
  const missing = [...findMissingEnvGroups()];
  if (missing.length === 0) {
    // 上流の relay は env が揃っているときだけ叩く（足りないなら叩いても意味がない）。
    const usesRelay = !isSet('OPENAI_ADS_PIXEL_ID') || !isSet('OPENAI_ADS_CAPI_KEY');
    if (usesRelay && !(await relayIsReady())) missing.push('openai_ads_relay_upstream');
  }

  // env が揃っていても資格情報が失効していれば応募は1件も通らない。実際に叩いて確かめる。
  // env の不足とは独立に走らせる（APP_* 自体が欠けていれば not_configured が付くだけ）。
  const deep = request.nextUrl.searchParams.get('deep') !== '0';
  let unreachable: string[] = [];
  if (deep) {
    const profiles: LarkProfile[] = ['ridejob', 'mechanic', 'liftjob'];
    const results = await Promise.all(
      profiles.map(async (p) => ({ profile: p, result: await checkLarkAuth(p) })),
    );
    // not_configured は載せない。APP_* の欠落は REQUIRED_ENV_GROUPS が同じ9変数を持つので
    // missing で必ず名指しされている。unreachable に載せると監視側で「資格情報が通らない」
    // （🔴 毎回）と読まれ、既知の設定漏れで鳴りっぱなしになる。
    unreachable = results
      .filter((r) => !r.result.ok && (r.result as { reason: string }).reason !== 'not_configured')
      .map((r) => `lark_auth_${r.profile}:${(r.result as { reason: string }).reason}`);
  }

  if (missing.length > 0 || unreachable.length > 0) {
    return NextResponse.json(
      {
        status: 'degraded',
        // missing だけの応答が「実接続まで見たうえで env だけ足りない」のか「実接続を見て
        // いない」のかを、受け手が区別できるようにする（旧ビルドの degraded には無い）。
        deep,
        ...(missing.length > 0 ? { missing } : {}),
        ...(unreachable.length > 0 ? { unreachable } : {}),
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: 'ready', deep }, { status: 200 });
}
