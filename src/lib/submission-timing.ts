/**
 * 応募1件の所要時間と、いちばん時間の掛かった副作用を測る。
 *
 * サマリ行（`submission settled:`）に載せ、関数の実行上限（maxDuration）に近づいていることに、
 * 打ち切られる前に気づけるようにする。打ち切られた応募はサマリ行そのものが出ないので、
 * 打ち切りの検知には使えない（それは Vercel 側の Invocations のタイムアウト件数や Logs の 504 で見る）。
 *
 * - elapsedMs はルートの処理を始めてからの時間（コールドスタートの初期化は含まない）
 * - slowest の候補は time() でくるんだ副作用だけ（前段の広告画像の解決や request.json() は含まない）
 */

export type SubmissionTiming = {
  elapsedMs: number;
  /** いちばん時間の掛かった副作用。副作用が1つも無ければ null。 */
  slowest: { task: string; ms: number } | null;
};

export function createSubmissionTimer(now: () => number = () => Date.now()) {
  const startedAt = now();
  const taskMs = new Map<string, number>();
  return {
    /** 副作用が終わる（成功・失敗とも）までの時間を記録する。渡した Promise の結果はそのまま返す。 */
    time<T>(task: string, promise: Promise<T>): Promise<T> {
      const taskStartedAt = now();
      return promise.finally(() => {
        taskMs.set(task, now() - taskStartedAt);
      });
    },
    summary(): SubmissionTiming {
      let slowest: SubmissionTiming['slowest'] = null;
      for (const [task, ms] of taskMs) {
        if (!slowest || ms > slowest.ms) slowest = { task, ms };
      }
      return { elapsedMs: now() - startedAt, slowest };
    },
  };
}

/**
 * 所要時間が実行上限の半分以上なら、警告の文言を返す（未満なら null）。
 * 半分を目安にするのは、上限そのものに届いてからでは打ち切られてサマリ行も出ないため。
 */
export function describeSlowSubmission(timing: SubmissionTiming, maxDurationSec: number): string | null {
  if (timing.elapsedMs < (maxDurationSec * 1000) / 2) return null;
  const slowest = timing.slowest ? `${timing.slowest.task}(${timing.slowest.ms}ms)` : 'n/a';
  return `submission slow: elapsedMs=${timing.elapsedMs} slowest=${slowest} limit=${maxDurationSec}s`;
}
