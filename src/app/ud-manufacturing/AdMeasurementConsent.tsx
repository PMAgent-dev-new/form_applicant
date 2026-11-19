'use client';

import { useId } from 'react';
import { assetPath } from '@/lib/basePath';

export default function AdMeasurementConsent({ checked, onChange, disabled = false }: {
  checked: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return <div className="my-4 text-left text-sm leading-6 text-gray-900">
    <div className="flex min-h-11 items-start gap-2">
      <input id={id} name="udAdConsent" type="checkbox" checked={checked} disabled={disabled}
        onChange={event => onChange(event.target.checked)} aria-describedby={`${id}-help`}
        className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-orange-600" />
      <label htmlFor={id} className="cursor-pointer">【任意】広告効果の測定のため、Meta・Googleへの情報提供に同意します</label>
    </div>
    <p id={`${id}-help`} className="mt-1 pl-7">同意しなくても応募できます。<a href={assetPath('/ud-manufacturing/privacy')} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2">詳細</a></p>
  </div>;
}
