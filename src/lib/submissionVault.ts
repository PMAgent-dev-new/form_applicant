/**
 * 応募・問い合わせの退避先（Supabase submission_vault）。
 *
 * 経緯: 2026-09-17〜09-23、Lark Base への保存が失敗すると HTTP 500 で即 return する
 * 実装（PR #89）により、自社LP経由の応募が5日間まるごと失われた（推定 約90件）。
 * 通知もメールもSMSも走らず、応募者の氏名・電話・メールがどこにも残らなかった。
 *
 * PR #93 で「Base に入らなくても Lark 通知だけは出す」ところまでは直したが、
 * 通知は流れて埋もれる。**構造化された受け皿を1つ持たせる**のがこのモジュール。
 *
 * 原則:
 *  - Lark Base への保存が失敗したときだけ書く。正常時は1行も増えない。
 *    このテーブルに行があること自体が異常で、監視の対象になる。
 *  - **ここでの失敗は応募を止めない。** 退避に失敗しても応募は 200 で通す。
 *    退避先を増やしたせいで応募が落ちるのでは本末転倒。
 *  - service_role キーでのみ読み書きする。RLS 有効・ポリシー0件なので
 *    anon キーからは1行も見えない（2026-09-23 に実データで検証済み）。
 */

const VAULT_TIMEOUT_MS = 4000;

export type VaultEntry = {
  /** どのルートから来たか。例: 'form_applicant/applicants' */
  source: string;
  kind: 'application' | 'contact';
  /** 冪等キー。無い経路は undefined でよい（重複排除が効かなくなるだけ） */
  submissionId?: string;
  /** ridejob / mechanic / liftjob など */
  profile?: string;
  /** なぜ退避したか。Lark が返したコードとメッセージを含めること */
  reason: string;
  /** Lark 通知だけは出せたか。false なら誰も応募に気づいていない */
  notified: boolean;
  payload: Record<string, unknown>;
};

export function isSubmissionVaultConfigured(): boolean {
  return Boolean(process.env.SUBMISSION_VAULT_URL && process.env.SUBMISSION_VAULT_SERVICE_KEY);
}

/**
 * 退避を試みる。**成否に関わらず例外を投げない。**
 * 戻り値は「退避できたか」。呼び出し側はログと通知の文面にだけ使う。
 */
export async function saveToSubmissionVault(entry: VaultEntry): Promise<boolean> {
  const url = process.env.SUBMISSION_VAULT_URL;
  const key = process.env.SUBMISSION_VAULT_SERVICE_KEY;
  if (!url || !key) {
    console.error('[vault] 未設定のため退避できない:', `source=${entry.source} submission=${entry.submissionId ?? 'n/a'}`);
    return false;
  }
  try {
    const resp = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/submission_vault`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        // 同じ submission_id での再送は1行に畳む（source, submission_id の部分一意索引）
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        source: entry.source,
        kind: entry.kind,
        submission_id: entry.submissionId || null,
        profile: entry.profile || null,
        reason: entry.reason.slice(0, 2000),
        notified: entry.notified,
        payload: entry.payload,
      }),
      signal: AbortSignal.timeout(VAULT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[vault] 退避に失敗:', `source=${entry.source} http=${resp.status} ${body.slice(0, 200)}`);
      return false;
    }
    console.log('[vault] 退避した:', { source: entry.source, submissionId: entry.submissionId, notified: entry.notified });
    return true;
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[vault] 退避で例外:', `source=${entry.source} ${detail}`);
    return false;
  }
}
