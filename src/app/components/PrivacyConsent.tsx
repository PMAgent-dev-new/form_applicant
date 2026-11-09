'use client';

import { useCallback, useId, useState } from 'react';
import { PRIVACY_CONSENT_ERROR, PRIVACY_POLICY_URL, privacyConsentPayload } from '@/lib/privacy-consent';

export function usePrivacyConsent() {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const onChange = useCallback((accepted: boolean) => {
    setChecked(accepted);
    setError('');
  }, []);
  const validate = useCallback(() => {
    setError(checked ? '' : PRIVACY_CONSENT_ERROR);
    return checked;
  }, [checked]);
  return { checked, error, onChange, validate, payload: checked ? privacyConsentPayload() : null };
}

export type PrivacyConsentState = ReturnType<typeof usePrivacyConsent>;

export default function PrivacyConsent({ consent, disabled = false, policyHref = PRIVACY_POLICY_URL }: {
  consent: PrivacyConsentState;
  disabled?: boolean;
  policyHref?: string;
}) {
  const id = useId();
  return <div className="my-4 text-left text-sm leading-6 text-gray-900">
    <div className="flex min-h-11 items-center gap-2">
      <input id={id} name="privacyConsent" type="checkbox" required
        checked={consent.checked} disabled={disabled}
        onChange={event => consent.onChange(event.target.checked)}
        aria-describedby={consent.error ? `${id}-error` : undefined}
        aria-invalid={Boolean(consent.error)}
        className="h-5 w-5 shrink-0 cursor-pointer accent-orange-600" />
      <label htmlFor={id} className="cursor-pointer">
        <a href={policyHref} target="_blank" rel="noopener noreferrer"
          className="text-blue-700 underline underline-offset-2">プライバシーポリシー</a>に同意しますか
      </label>
    </div>
    {consent.error && <p id={`${id}-error`} role="alert" className="text-sm text-red-700">{consent.error}</p>}
  </div>;
}
