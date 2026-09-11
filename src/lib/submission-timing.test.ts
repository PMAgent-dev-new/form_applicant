import { describe, expect, it } from 'vitest';
import { createSubmissionTimer, describeSlowSubmission } from './submission-timing';

describe('createSubmissionTimer', () => {
  it('全体の所要時間と、いちばん時間の掛かった副作用を返す', async () => {
    let t = 1_000;
    const timer = createSubmissionTimer(() => t);

    await timer.time('application-sms', Promise.resolve().then(() => { t += 100; }));
    await timer.time('lark-base', Promise.resolve().then(() => { t += 2_000; }));

    expect(timer.summary()).toEqual({ elapsedMs: 2_100, slowest: { task: 'lark-base', ms: 2_000 } });
  });

  it('失敗した副作用の時間も記録し、失敗はそのまま返す', async () => {
    let t = 0;
    const timer = createSubmissionTimer(() => t);

    const failing = Promise.resolve().then(() => {
      t += 300;
      throw new Error('boom');
    });
    await expect(timer.time('confirmation-email', failing)).rejects.toThrow('boom');

    expect(timer.summary().slowest).toEqual({ task: 'confirmation-email', ms: 300 });
  });

  it('副作用が無ければ slowest は null', () => {
    const timer = createSubmissionTimer(() => 0);
    expect(timer.summary()).toEqual({ elapsedMs: 0, slowest: null });
  });
});

describe('describeSlowSubmission', () => {
  it('上限の半分未満なら警告しない', () => {
    expect(describeSlowSubmission({ elapsedMs: 29_999, slowest: null }, 60)).toBeNull();
  });

  it('上限の半分以上なら、所要時間といちばん遅い副作用を1行で返す', () => {
    expect(
      describeSlowSubmission({ elapsedMs: 30_000, slowest: { task: 'lark-base', ms: 29_000 } }, 60),
    ).toBe('submission slow: elapsedMs=30000 slowest=lark-base(29000ms) limit=60s');
  });
});
