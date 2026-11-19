'use client';

import { useId, type KeyboardEvent } from 'react';
import { MARKETING_ACTIONS, type MarketingAction, type MarketingIntent } from '@/lib/marketing-consent';

// 入力欄のEnterでブラウザが先頭ボタンを代理クリックすることによる自動同意を防ぐ。
// フォーカスしたボタンのEnter/Space操作は維持する。
export function preventImplicitMarketingSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.nativeEvent.isComposing) return;
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
}

export default function MarketingConsent({ intent = 'registration', disabled = false, isSubmitting = false }: {
  intent?: MarketingIntent; disabled?: boolean; isSubmitting?: boolean;
}) {
  const id = useId();
  const actions: MarketingAction[] = intent === 'registration' ? ['register']
    : intent === 'apply' ? ['apply_with_updates', 'apply_only'] : ['consult_with_updates', 'consult_only'];
  return <div className="my-4 space-y-3 text-left text-sm leading-6 text-gray-900">
    <p id={id}>{MARKETING_ACTIONS[actions[0]].notice}</p>
    {actions.map(action => <button key={action} type="submit" data-marketing-action={action}
      disabled={disabled} aria-describedby={id}
      className={`w-full min-h-12 rounded-md border px-3 py-3 text-sm font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${MARKETING_ACTIONS[action].accepted ? 'border-transparent bg-[#c44812] text-white' : 'border-gray-400 bg-white text-gray-900'}`}>
      {isSubmitting ? '送信中…' : MARKETING_ACTIONS[action].label}
    </button>)}
    {intent !== 'registration' && <p className="text-sm text-gray-700">
      {intent === 'apply' ? 'どちらでも応募・選考の連絡をメール・SMSでお送りします。' : 'どちらでも相談の連絡をメール・SMSでお送りします。'}
    </p>}
  </div>;
}
