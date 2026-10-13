/**
 * 受付台帳（Supabase submissions）。応募・問い合わせを、成否に関わらず1件1行で残す。
 * Shared: keep this file identical in form_applicant/jobmadley/newmedia.
 *
 * - submission_vault（取りこぼしの受け皿。行があること自体が異常）とは別の表。こちらは正常に受け付けても1行増える。
 * - ここでの失敗は受付を止めない。例外を投げず、結果は戻り値とログだけにする。
 * - 応答の本文をログに出さない（制約違反の details に行の値がそのまま入るため）。
 * - 同じ (source, submission_id) の2件目は入れない（最初の受付の記録を残す）。再送を前提にした 503（何もせずに返す・別のリクエストが処理中）は、入口の側で記録しない。
 * - 入口からは recordSubmissionAfterResponse() を使う（応答を返したあとに書くので、応募者を待たせない）。すでに after() の中にいる入口は recordSubmission() を待つ。
 */
import { createHash } from 'node:crypto';
import { after } from 'next/server';

const LEDGER_TIMEOUT_MS = 4000;
const MAX_NOTIFICATION_TEXT = 20000;

export type SubmissionRecord = {
  /** 入口。submission_vault の source と同じ値にする（例: 'form_applicant/applicants'） */
  source: string;
  kind: 'application' | 'contact';
  /** 入口ごとの受付ID。無い入口は derivedSubmissionId() で作る */
  submissionId: string;
  /** ridejob / mechanic / liftjob など */
  profile?: string;
  /** 応募者が送った中身（個人情報を含む） */
  applicant: Record<string, unknown>;
  /** 応募経路（normalizeApplicationContext の結果・utm・リクエストの情報など） */
  context?: unknown;
  /** 広告情報（enrichApplication の結果など） */
  ad?: Record<string, unknown>;
  /** Lark 通知の本文と、送れたか */
  notification?: { text?: string; sent?: boolean; via?: string };
  /** Base・通知・自動返信・SMS・退避の結果と、返した HTTP ステータス */
  outcome?: Record<string, unknown>;
};

const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/**
 * 受付IDを持たない入口（問い合わせなど）の受付ID。
 * 同じ日（日本時間）に同じ中身を送り直したものは同じIDになり、二重送信が1行にまとまる。
 */
export function derivedSubmissionId(prefix: string, parts: Array<string | undefined>): string {
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const digest = createHash('sha256').update([...parts.map((p) => (p ?? '').trim()), day].join('|')).digest('hex');
  return `${prefix}:${digest.slice(0, 32)}`;
}

/**
 * 応答を返したあとに記録する（after）。after() が使えない場面（リクエストの外・テスト）では、その場で書き始める（待たない）。
 * 呼んだ時点の中身を写してから書くので、呼んだあとに record を変えても記録には入らない。
 */
export function recordSubmissionAfterResponse(record: SubmissionRecord): void {
  let snapshot: SubmissionRecord;
  try {
    snapshot = JSON.parse(JSON.stringify(record)) as SubmissionRecord;
  } catch (e) {
    console.error('[ledger] 記録の中身を写せない:', `source=${record.source} ${e instanceof Error ? e.name : 'error'}`);
    return;
  }
  try {
    after(async () => { await recordSubmission(snapshot); });
  } catch {
    void recordSubmission(snapshot);
  }
}

export async function recordSubmission(record: SubmissionRecord): Promise<boolean> {
  const url = process.env.SUBMISSION_VAULT_URL;
  const key = process.env.SUBMISSION_VAULT_SERVICE_KEY;
  if (!url || !key) {
    console.error('[ledger] 未設定のため記録できない:', `source=${record.source}`);
    return false;
  }
  const submissionId = String(record.submissionId ?? '').trim().slice(0, 200);
  if (!submissionId) {
    console.error('[ledger] 受付IDが無いため記録できない:', `source=${record.source}`);
    return false;
  }
  try {
    const resp = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/submissions?on_conflict=source,submission_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        source: record.source,
        kind: record.kind,
        submission_id: submissionId,
        profile: record.profile || null,
        applicant: object(record.applicant),
        context: object(record.context),
        ad: object(record.ad),
        notification: record.notification
          ? { ...record.notification, text: record.notification.text?.slice(0, MAX_NOTIFICATION_TEXT) }
          : {},
        outcome: object(record.outcome),
      }),
      signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const code = await resp.json().then((b) => String((b as { code?: string })?.code ?? '')).catch(() => '');
      console.error('[ledger] 記録に失敗:', `source=${record.source} http=${resp.status} code=${code}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[ledger] 記録で例外:', `source=${record.source} ${e instanceof Error ? e.name : 'error'}`);
    return false;
  }
}
