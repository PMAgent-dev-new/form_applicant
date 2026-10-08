import { describeError } from './describe-error';

/** PII・URL・外部応答本文を受け取らず、制御された処理名と計測値だけを残す。 */
export function createSubmissionObservability(route: 'applicants' | 'coupang') {
  const started = performance.now();
  const failed: string[] = [];
  const phaseMs: Record<string, number> = {};
  let taskCount = 0;
  let mode: 'base-only' | 'full' | undefined;
  const setMode = (value: 'base-only' | 'full') => { mode = value; };
  const markFailed = (label: string) => {
    if (!failed.includes(label)) failed.push(label);
  };
  const startPhase = (label: string) => {
    const phaseStarted = performance.now();
    return () => { phaseMs[label] = Math.round(performance.now() - phaseStarted); };
  };
  const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const finish = startPhase(label);
    try {
      return await run();
    } finally {
      finish();
    }
  };
  const trackTask = (label: string, run: () => Promise<unknown>): Promise<void> => {
    taskCount += 1;
    return timed(label, async () => {
      try {
        await run();
      } catch (error) {
        markFailed(label);
        console.error(`[${route}] ${label} failed: ${describeError(error)}`);
      }
    });
  };
  const settled = () => {
    console.log(`[${route}] submission settled: ${JSON.stringify({
      tasks: taskCount, failed, totalMs: Math.round(performance.now() - started), phaseMs, mode,
    })}`);
  };
  return { failed, markFailed, startPhase, timed, trackTask, settled, setMode };
}
