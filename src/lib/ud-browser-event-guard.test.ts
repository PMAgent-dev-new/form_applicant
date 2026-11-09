import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '@/app/components/application-form/utils/trackEvent';
import { trackMeta } from './meta/pixel';

describe('UDイベントを汎用計測キューへ混入させない', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['/ud-manufacturing', '/entry/ud-manufacturing', '/entry/ud-manufacturing/applicants/new'])('%s は既存fbqがあっても送信しない', pathname => {
    const fbq = vi.fn(), push = vi.fn();
    vi.stubGlobal('window', { location: { pathname }, fbq, dataLayer: { push } });
    trackMeta('Lead', {}, 'test-id');
    trackEvent('form_submit', { form_name: 'ridejob_application' });
    expect(fbq).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
  it('既存フォームはイベント送信を維持する', () => {
    const fbq = vi.fn(), push = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/entry/truck' }, fbq, dataLayer: { push } });
    trackMeta('Lead', {}, 'test-id');
    trackEvent('form_submit', { form_name: 'ridejob_application' });
    expect(fbq).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledOnce();
  });
});
