import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMarketingConsent, marketingConsentPayload } from './marketing-consent';
import { restoreMarketingConsent } from './marketing-consent-server';
const contact = { email: 'test@example.invalid', phone: '00000000000' };
const context = { source: 'test/applications', submissionId: 'retry-id', ...contact };
const first = readMarketingConsent(marketingConsentPayload('register'), { receivedAt: '2026-11-13T01:00:00.000Z', ...contact });
const retry = readMarketingConsent(marketingConsentPayload('register'), { receivedAt: '2026-11-13T02:00:00.000Z', ...contact });
beforeEach(() => { vi.stubEnv('SUBMISSION_VAULT_URL', 'https://example.invalid'); vi.stubEnv('SUBMISSION_VAULT_SERVICE_KEY', 'test'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('再送時の配信同意', () => {
  it('初回保存失敗後の退避証跡を再送成功時にも引き継ぐ', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('submission_vault') ? [{ created_at: first.received_at, payload: { ...contact, marketing_consent: first } }] : [])));
    expect(await restoreMarketingConsent(retry, context)).toEqual(first);
  });
  it('初回の未同意を再送で同意済みへ書き換えない', async () => {
    const declined = readMarketingConsent(marketingConsentPayload('apply_only'), { receivedAt: first.received_at, ...contact });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('submission_vault') ? [] : [{ created_at: first.received_at, applicant: contact, context: { marketing_consent: declined } }])));
    expect(await restoreMarketingConsent(retry, context)).toEqual(declined);
  });
  it('新規応募は今回の選択を使う', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
    expect(await restoreMarketingConsent(retry, context)).toEqual(retry);
  });
  it('連絡先の変更・照合失敗では同意を補完せず応募を妨げない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ created_at: first.received_at, applicant: { ...contact, phone: '999' }, context: { marketing_consent: first } }])));
    expect(await restoreMarketingConsent(retry, context)).toMatchObject({ accepted: false, status: 'unverified' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await restoreMarketingConsent(retry, context)).toMatchObject({ accepted: false, status: 'unverified' });
  });
});

it('旧checkbox証跡をボタン方式の再送でも上書きしない', async () => {
  const old = { ...first, method: 'checkbox', notice_version: 'job-updates-v1-2026-11-13', notice_text: '旧表示文' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('submission_vault') ? [] : [{ created_at: first.received_at, applicant: contact, context: { marketing_consent: old } }])));
  expect(await restoreMarketingConsent(retry, context)).toEqual(old);
});
