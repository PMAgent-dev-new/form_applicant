import { describe, expect, it } from 'vitest';
import { assessUdLaunchTest } from './ud-launch-test';
const now = Date.parse('2026-11-06T03:00:00Z');
const env = { HEALTH_CHECK_TOKEN: 'unit-only-secret-'.repeat(3), UD_LAUNCH_TEST_SUBMISSION_ID: 'ud-launch-test-abcdefghijklmnop', UD_LAUNCH_TEST_EXPIRES_AT: '2026-11-06T04:00:00Z' };
const body = { formOrigin: 'ud_manufacturing', submissionId: env.UD_LAUNCH_TEST_SUBMISSION_ID, fullName: 'テスト UD応募確認', email: 'ud-launch-test@example.invalid', phoneNumber: '09000000000' };
const headers = new Headers({ 'x-ud-launch-test-token': env.HEALTH_CHECK_TOKEN });
describe('期限付き・1受付IDのUD公開前テスト', () => {
  it('一般応募は通常経路、許可した合成データだけテスト', () => {
    expect(assessUdLaunchTest(new Headers(), body, env, now)).toBe('none');
    expect(assessUdLaunchTest(headers, body, env, now)).toBe('authorized');
  });
  it('不正な認証、未設定、期限、実在連絡先、別受付IDは拒否', () => {
    for (const badEnv of [{}, { ...env, HEALTH_CHECK_TOKEN: 'short' }, { ...env, UD_LAUNCH_TEST_EXPIRES_AT: 'invalid' }, { ...env, UD_LAUNCH_TEST_EXPIRES_AT: '2026-11-06T02:00:00Z' }, { ...env, UD_LAUNCH_TEST_EXPIRES_AT: '2026-11-08T04:00:00Z' }])
      expect(assessUdLaunchTest(headers, body, badEnv, now)).toBe('denied');
    for (const patch of [{ email: 'person@example.com' }, { phoneNumber: '08011111111' }, { fullName: '実在の氏名' }, { submissionId: 'another-id' }, { formOrigin: 'mechanic' }])
      expect(assessUdLaunchTest(headers, { ...body, ...patch }, env, now)).toBe('denied');
    expect(assessUdLaunchTest(new Headers(), { ...body, launchTest: true }, env, now)).toBe('denied');
    expect(assessUdLaunchTest(new Headers({ 'x-ud-launch-test-token': 'wrong' }), body, env, now)).toBe('denied');
  });
});
