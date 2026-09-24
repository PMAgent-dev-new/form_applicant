import { NextRequest, NextResponse } from 'next/server';

import { checkLarkAuth, checkBaseColumns, type LarkProfile } from '@/lib/larkBase';
import { resolveDirectBaseWrite, type BaseWriteContext } from '@/app/api/applicants/route';
import { buildLiftJobDirectBaseFields, LIFTJOB_TABLE_ID } from '@/app/api/coupang/applicants/route';

/**
 * デプロイ後の合成チェック用ヘルスエンドポイント。
 *
 * 二段構え:
 * - トークン無し(または不一致): 生存確認のみ。200 {status:'ok'} を返し、設定内容は一切漏らさない。
 *   公開エンドポイントなので、どのenvが欠けているか等の内部情報は無認証では出さない。
 * - 正しいトークン(x-health-token が env HEALTH_CHECK_TOKEN と一致): レディネスを返す。
 *   env が揃い資格情報も実際に通れば 200 {status:'ready', deep:true}。
 *   問題があれば 503 {status:'degraded', missing?:[...], unreachable?:[...], mismatched?:[...]}。
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

// 実接続チェックの対象。**ここに足したら REQUIRED_ENV_GROUPS にも APP_* の3変数を足すこと。**
// not_configured を unreachable に載せないのは、APP_* の欠落が missing で必ず名指しされる
// という前提があるから。片方だけ足すと、資格情報が無いのに missing にも unreachable にも
// 出ない＝誰も鳴らない状態が黙って生まれる（route.test.ts がこの前提を検査している）。
export const DEEP_CHECK_PROFILES: LarkProfile[] = ['ridejob', 'mechanic', 'liftjob'];
// relay チェック(最大5秒) → deep チェック(最大5秒) → 列の確認(認証が通ったプロファイルのみ。
// larkBase.ts の COLUMN_CHECK_BUDGET_MS で区切る。トークンの取り直しが入ると少しはみ出す)の順に
// 直列で走るので、コールドスタート分を足すと既定の実行上限(10秒)に触れて 504 になり得る。504 は
// guard から見ると unhealthy と同じなので、上限を明示して「本当に壊れている」とだけ区別する。
// guard（scripts/post-deploy-guard.mjs）の待ち時間はこれより長くしておくこと。
export const maxDuration = 25;

// resolveDirectBaseWrite / buildLiftJobDirectBaseFields を呼ぶための最小入力。
// 列チェックは「どのキーで書き込むか」だけが要るので、値はすべて空文字・空オブジェクト・0で埋める
// （変換関数が例外を投げない最小値。実際に Base へ書き込むことはない）。
const BASE_WRITE_COLUMN_CHECK_FIXTURE: BaseWriteContext = {
  isMechanic: false,
  isMechanicNewgrad: false,
  isCoupang: false,
  isTruck: false,
  isBus: false,
  isTaxi: false,
  truckLicensesLabel: '',
  mediaName: '',
  utm: {},
  adId: '',
  adCreativeId: '',
  adImageUrl: '',
  form: {},
  jobTimingLabel: '',
  jobIntentLabel: '',
  desiredIncomeLabel: '',
  mechanicQualificationsLabel: '',
  qualificationFieldLabel: '',
  pageUrl: '',
  submittedAtMs: 0,
  submissionId: '',
};

// 通知のあとに書き戻す列。組み立て関数を通らずに updateBaseRecord で書く（applicants/route.ts・
// coupang/applicants/route.ts）ので、ここで足す。ridejob は代わりに対応履歴メモへ印を書く（期待列に入っている）。
const NOTIFIED_FLAG_COLUMN = 'Lark通知送信済み';

export type ExpectedColumnsGroup = { profile: LarkProfile; tableId: string; expected: string[] };

// プロファイルごとに、書き込み側の組み立て関数のキーから期待列を作る。
// 列が無いときの壊れ方は列によって違う（書き込みごと失敗する／linkedRecordName で渡すリンク列や
// 通知後の書き戻しは、その項目だけが落ちる）。どれも応募か帰属が欠けるので、同じく不足として返す。
// テスト（route.test.ts）が fetch のスタブ先を決めるためにも import して使う。
export function resolveExpectedColumnsGroups(): ExpectedColumnsGroup[] {
  const groups: ExpectedColumnsGroup[] = [];

  // isCoupang:false の入力では resolveDirectBaseWrite は null を返さないが、戻り値の型が
  // `DirectBaseWrite | null` のため防御的にガードする（null ならそのプロファイルの列は調べない）。
  const ridejobWrite = resolveDirectBaseWrite(BASE_WRITE_COLUMN_CHECK_FIXTURE);
  if (ridejobWrite) {
    groups.push({ profile: 'ridejob', tableId: ridejobWrite.tableId, expected: Object.keys(ridejobWrite.fields) });
  }

  // 経験者でも新卒でもキーは同じ（転職時期・資格は値が undefined になるだけ）。値の変換を通らない新卒の入力で組み立てる。
  const mechanicWrite = resolveDirectBaseWrite({
    ...BASE_WRITE_COLUMN_CHECK_FIXTURE,
    isMechanic: true,
    isMechanicNewgrad: true,
  });
  if (mechanicWrite) {
    groups.push({
      profile: 'mechanic',
      tableId: mechanicWrite.tableId,
      expected: [...Object.keys(mechanicWrite.fields), NOTIFIED_FLAG_COLUMN],
    });
  }

  groups.push({
    profile: 'liftjob',
    tableId: LIFTJOB_TABLE_ID,
    expected: [...Object.keys(buildLiftJobDirectBaseFields({})), NOTIFIED_FLAG_COLUMN],
  });

  return groups;
}

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
  let mismatched: string[] = [];
  if (deep) {
    const results = await Promise.all(
      DEEP_CHECK_PROFILES.map(async (p) => ({ profile: p, result: await checkLarkAuth(p) })),
    );
    // not_configured は載せない。APP_* の欠落は REQUIRED_ENV_GROUPS が同じ9変数を持つので
    // missing で必ず名指しされている。unreachable に載せると監視側で「資格情報が通らない」
    // （🔴 毎回）と読まれ、既知の設定漏れで鳴りっぱなしになる。
    unreachable = results
      .filter((r) => !r.result.ok && (r.result as { reason: string }).reason !== 'not_configured')
      .map((r) => `lark_auth_${r.profile}:${(r.result as { reason: string }).reason}`);

    // 認証が通らない・未設定のプロファイルは、列を調べても意味が無いので重ねて呼ばない。
    const okProfiles = new Set(results.filter((r) => r.result.ok).map((r) => r.profile));
    const columnResults = await Promise.all(
      resolveExpectedColumnsGroups()
        .filter((g) => okProfiles.has(g.profile))
        .map(async (g) => ({
          profile: g.profile,
          check: await checkBaseColumns(g.profile, g.tableId, g.expected),
        })),
    );
    mismatched = columnResults.flatMap(({ profile, check }) => {
      if (check.ok) return [];
      if (check.reason === 'missing_columns') {
        return (check.missingColumns ?? []).map((col) => `lark_columns_${profile}:${col}`);
      }
      // 表そのものが読めない（権限・app_token・表 ID）ときは列の話ではないので、jobmadley と同じ名前にする。
      return [`lark_base_${profile}:${check.reason}`];
    });
  }

  if (missing.length > 0 || unreachable.length > 0 || mismatched.length > 0) {
    return NextResponse.json(
      {
        status: 'degraded',
        // missing だけの応答が「実接続まで見たうえで env だけ足りない」のか「実接続を見て
        // いない」のかを、受け手が区別できるようにする（旧ビルドの degraded には無い）。
        deep,
        ...(missing.length > 0 ? { missing } : {}),
        ...(unreachable.length > 0 ? { unreachable } : {}),
        ...(mismatched.length > 0 ? { mismatched } : {}),
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: 'ready', deep }, { status: 200 });
}
