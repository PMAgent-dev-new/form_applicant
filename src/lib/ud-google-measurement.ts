import { readUdMeasurementReceipt } from './ud-ad-consent';

// Google Ads 2188576396 / conversion_action 6915031199 のtag_snippetsを2026-11-09に読戻し。
// 既存のリード問い合わせ完了を利用し、新しい成果定義・GTMタグは作らない。
export const UD_GOOGLE_SEND_TO = 'AW-10985325722/VNHMCJ-BrOEZEJqJm_Yo';
export const UD_GOOGLE_TAG_ID = UD_GOOGLE_SEND_TO.split('/')[0];

export function udGoogleCommands(raw: string | null, now = Date.now()): unknown[][] {
  const receipt = readUdMeasurementReceipt(raw, now);
  if (!receipt) return [];
  return [
    // Basic consent mode: この同意済み受領証がない場合、タグもpingも読み込まない。
    // Googleにはメール/電話等のuser_dataを渡さず、広告の個人最適化も無効にする。
    ['consent', 'default', { ad_storage: 'granted', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }],
    ['set', 'allow_ad_personalization_signals', false],
    ['js', new Date(now)],
    ['config', UD_GOOGLE_TAG_ID, { send_page_view: false, allow_google_signals: false }],
    ['event', 'conversion', { send_to: UD_GOOGLE_SEND_TO, transaction_id: receipt.id }],
  ];
}
