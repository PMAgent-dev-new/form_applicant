'use client';
import { useEffect } from 'react';
import { UD_RECEIPT_KEY } from '@/lib/ud-manufacturing';
import { trackEvent } from '@/app/components/application-form/utils/trackEvent';

export default function CompletionEvent() {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(UD_RECEIPT_KEY);
      sessionStorage.removeItem(UD_RECEIPT_KEY);
      if (!raw) return;
      const receipt = JSON.parse(raw);
      const elapsed = Date.now() - receipt.at;
      if (typeof receipt.id !== 'string' || elapsed < 0 || elapsed > 15 * 60 * 1000) return;
      trackEvent('form_complete', { form_type: 'ud_manufacturing', submission_id: receipt.id });
    } catch { /* 直接訪問・再読込は成果を加算しない。 */ }
  }, []);
  return null;
}
