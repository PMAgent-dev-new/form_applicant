/**
 * セミナー日程取得API（GAS連携）。
 *
 * ⚠️ **現行のクーパンLPからは呼ばれていない。** 唯一の消費者だった useSeminarSlots は
 * 2026-08-25 に削除済みで、このエンドポイントは孤立している。
 * すぐ消さないのは、外部（GAS側の別スクリプト等）から叩かれていないかの確認が
 * まだ取れていないため。2ゾーン（ridejob.pmagent.jp / ridejob.jp/entry）に
 * デプロイされるので、両方のアクセスログを見る必要がある。
 *
 * **期限: 2026年9月のクーパン再配信の判断時までに確認し、このファイルごと削除する。**
 * それまでに確認が取れない場合も、配信開始後に再度この行を読み直すこと。
 */
import { NextResponse } from 'next/server';

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzDNerH9-MnemIZHyWgbdeRJ2TEL6U3ThTVjUH9rm4eB_GHl8SxrwJcpDiLLb7vWeIe/exec';

export type SeminarSlot = {
  date: string;
  url: string;
};

export type SeminarSlotsResponse = {
  events: SeminarSlot[];
};

export async function GET() {
  try {
    const response = await fetch(GAS_API_URL, {
      method: 'GET',
      redirect: 'follow',
      // キャッシュ5分間
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      console.error(`Failed to fetch seminar slots: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: 'セミナー枠の取得に失敗しました' },
        { status: 500 }
      );
    }

    const rawData = await response.json();
    console.log('Fetched raw data:', rawData);

    // GAS APIは配列を直接返すので、eventsプロパティでラップ
    let data: SeminarSlotsResponse;
    if (Array.isArray(rawData)) {
      data = { events: rawData };
    } else if (rawData.events) {
      data = rawData as SeminarSlotsResponse;
    } else {
      console.error('Unexpected response format:', rawData);
      return NextResponse.json(
        { error: 'セミナー枠の取得に失敗しました' },
        { status: 500 }
      );
    }

    console.log('Returning data:', data);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('Error fetching seminar slots:', error);
    return NextResponse.json(
      { error: 'セミナー枠の取得に失敗しました' },
      { status: 500 }
    );
  }
}
