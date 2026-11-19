import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivacyConsent, { usePrivacyConsent } from './PrivacyConsent';
import { LP_HTML } from '../gulliver/newgraduate/content';
import { PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION } from '@/lib/privacy-consent';

function InitialConsent() {
  const consent = usePrivacyConsent();
  return <PrivacyConsent consent={consent} />;
}
describe('同意欄の表示', () => {
  it('初期未チェックで短い文言と別タブのリンクだけを表示する', () => {
    const html = renderToStaticMarkup(<InitialConsent />);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('に同意しますか');
    expect(html).toContain(`href="${PRIVACY_POLICY_URL}"`);
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('Gulliverの既存1チェックも同じ版・URLをFormDataに含める', () => {
    expect(LP_HTML.match(/type="checkbox"/g)).toHaveLength(1);
    expect(LP_HTML).toContain('name="privacyConsent" value="true" required');
    expect(LP_HTML).toContain(`name="privacyPolicyVersion" value="${PRIVACY_POLICY_VERSION}"`);
    expect(LP_HTML).toContain(`name="privacyPolicyUrl" value="${PRIVACY_POLICY_URL}"`);
    const label = LP_HTML.match(/<label for="agree"[^>]*>([\s\S]*?)<\/label>/)?.[1] || '';
    expect(label).toContain(`href="${PRIVACY_POLICY_URL}"`);
    expect(label).not.toContain('https://www.idom-inc.com/privacy/');
  });
});
