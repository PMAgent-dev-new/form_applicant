'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { isUdPath } from '@/lib/ud-ad-consent';

// UDでは汎用GTMを使わない（他求人媒体のタグを含むため）。
// 同意後のUD専用イベントは専用の完了処理で送る。
export default function TrackingScripts({ metaPixelId }: { metaPixelId?: string }) {
  const pathname = usePathname();
  if (!pathname || isUdPath(pathname)) return null;
  return <>
    {metaPixelId && <Script id="meta-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{
      __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`,
    }} />}
    <Script id="gtm-script" strategy="lazyOnload" dangerouslySetInnerHTML={{
      __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-5CQGTMXF');`,
    }} />
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-5CQGTMXF" height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} /></noscript>
    {metaPixelId && <noscript>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img height="1" width="1" style={{ display: 'none' }} alt="" src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`} />
    </noscript>}
  </>;
}
