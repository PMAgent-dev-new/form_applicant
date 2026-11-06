import { timingSafeEqual } from 'node:crypto';

export const UD_TEST_MARKER = '[application_test:ud_launch]';

/** 管理者が事前に許可した1受付IDだけ。一般フォームの入力ではテストにできない。 */
export function assessUdLaunchTest(headers: Headers, body: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env, now = Date.now()): 'none' | 'authorized' | 'denied' {
  const token = headers.get('x-ud-launch-test-token');
  if (token === null && body.launchTest !== true) return 'none';
  const secret = env.HEALTH_CHECK_TOKEN || '';
  const expectedId = env.UD_LAUNCH_TEST_SUBMISSION_ID || '';
  const expiry = Date.parse(env.UD_LAUNCH_TEST_EXPIRES_AT || '');
  if (!token || secret.length < 24 || Buffer.byteLength(token) !== Buffer.byteLength(secret)
    || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))
    || !/^ud-launch-test-[a-zA-Z0-9-]{16,80}$/.test(expectedId)
    || body.submissionId !== expectedId || body.formOrigin !== 'ud_manufacturing'
    || !Number.isFinite(expiry) || expiry <= now || expiry > now + 24 * 3600_000
    || body.fullName !== 'テスト UD応募確認' || body.email !== 'ud-launch-test@example.invalid'
    || body.phoneNumber !== '09000000000') return 'denied';
  return 'authorized';
}
