'use client';

import { useId, useState } from 'react';
import { MARKETING_NOTICE, marketingConsentPayload } from '@/lib/marketing-consent';

export function useMarketingConsent() {
  const [checked, onChange] = useState(false);
  return { checked, onChange, payload: marketingConsentPayload(checked) };
}
export type MarketingConsentState = ReturnType<typeof useMarketingConsent>;

export default function MarketingConsent({ consent, disabled = false }: {
  consent: MarketingConsentState; disabled?: boolean;
}) {
  const id = useId();
  return <div className="my-4 text-left text-sm leading-6 text-gray-900">
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-2">
      <input id={id} name="marketingConsent" type="checkbox" checked={consent.checked}
        disabled={disabled} onChange={event => consent.onChange(event.target.checked)}
        aria-describedby={`${id}-help`} className="mt-1 h-5 w-5 shrink-0 accent-orange-600" />
      <span>{MARKETING_NOTICE}</span>
    </label>
    <p id={`${id}-help`} className="mt-1">同意しなくても応募できます。</p>
  </div>;
}
