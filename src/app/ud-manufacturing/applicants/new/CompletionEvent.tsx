'use client';
import { useEffect } from 'react';
import { UD_RECEIPT_KEY } from '@/lib/ud-manufacturing';
import { udGoogleCommands, UD_GOOGLE_TAG_ID } from '@/lib/ud-google-measurement';

export default function CompletionEvent() {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(UD_RECEIPT_KEY);
      sessionStorage.removeItem(UD_RECEIPT_KEY);
      const commands = udGoogleCommands(raw);
      if (!commands.length || document.getElementById('ud-google-measurement')) return;
      // 汎用GTMや入力ステップのdataLayerキューは再利用しない。
      const target = window as unknown as { udMeasurementLayer: IArguments[] };
      target.udMeasurementLayer = [];
      function enqueue(...args: unknown[]) {
        // gtag.js の公式キュー形式は IArguments。rest値は型検査のためだけに使う。
        // eslint-disable-next-line prefer-rest-params
        if (args.length) target.udMeasurementLayer.push(arguments);
      }
      commands.forEach(command => enqueue(...command));
      const script = document.createElement('script');
      script.id = 'ud-google-measurement';
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${UD_GOOGLE_TAG_ID}&l=udMeasurementLayer`;
      document.head.appendChild(script);
    } catch { /* 直接訪問・再読込は成果を加算しない。 */ }
  }, []);
  return null;
}
