// サーバー専用。同じ受付IDの再送では初回の選択・日時を引き継ぐ。
import { readMarketingConsent, type MarketingConsentRecord } from './marketing-consent';

export async function restoreMarketingConsent(
  current: MarketingConsentRecord,
  context: { source: string; submissionId: string; email?: string; phone?: string },
): Promise<MarketingConsentRecord> {
  const url = process.env.SUBMISSION_VAULT_URL;
  const key = process.env.SUBMISSION_VAULT_SERVICE_KEY;
  // 照合できない場合も応募は止めず、配信同意だけ未確認とする。
  const unverified = () => ({ ...current, accepted: false, status: 'unverified', channels: [] });
  if (!url || !key) return unverified();
  const query = new URLSearchParams({ source: `eq.${context.source}`, submission_id: `eq.${context.submissionId}`, limit: '1' });
  try {
    const rows = await Promise.all([
      ['submissions', 'context,applicant,created_at:received_at'],
      ['submission_vault', 'payload,created_at'],
    ].map(async ([table, select]) => {
      const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${table}?${query}&select=${select}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(2500), cache: 'no-store',
      });
      if (!response.ok) throw new Error('lookup_failed');
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('invalid_response');
      return data;
    }));
    const prior = rows.flat().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    if (!prior) return current;
    const applicant = prior.applicant ?? prior.payload ?? {};
    // IDを使い回した異なる連絡先へ同意を移さない。
    const text = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (text(applicant.email) !== text(context.email) || text(applicant.phone_number ?? applicant.phoneNumber ?? applicant.phone) !== text(context.phone)) return unverified();
    const saved = prior.context?.marketing_consent ?? prior.payload?.marketing_consent;
    if (!saved) return readMarketingConsent(undefined, { receivedAt: prior.created_at, pageUrl: current.page_url });
    if (typeof saved.accepted !== 'boolean' || !Number.isFinite(Date.parse(saved.received_at)) || saved.scope !== 'job_updates' || !Array.isArray(saved.channels)) return unverified();
    return saved as MarketingConsentRecord;
  } catch {
    // 応募内容・トークン・レスポンス本文はログに出さない。
    console.warn('[marketing-consent] 初回証跡の照合不可。応募受付は継続し、配信対象から除外');
    return unverified();
  }
}
