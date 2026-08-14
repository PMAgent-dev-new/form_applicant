import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

/**
 * 氏名 → ふりがな変換。
 *
 * クライアントで kuroshiro を動かすと、kuromoji の辞書（約17MB）を
 * 訪問者のブラウザにダウンロードさせることになる。広告クリックは
 * ほぼ初回訪問＝キャッシュ無しで、アプリ内ブラウザはキャッシュも
 * 分離されるため毎回発生していた。
 *
 * サーバー側で変換すれば、クライアントの転送は数百バイトで済み、
 * 回線品質にも依存しなくなる。辞書は node_modules/kuromoji/dict を
 * 直接読む（public/dict の配信は不要になる）。
 */

// fs を使うので edge 不可。辞書インスタンスはモジュールスコープで保持し、
// ウォームなコンテナでは初期化を再利用する。
export const runtime = 'nodejs';

/** 変換対象の最大長。氏名の想定を大きく超える入力は弾く。 */
const MAX_TEXT_LENGTH = 100;

type KuroshiroInstance = import('kuroshiro').default;

// モジュールスコープで保持し、ウォームなコンテナでは初期化を再利用する。
let initPromise: Promise<KuroshiroInstance | null> | null = null;

function getKuroshiro(): Promise<KuroshiroInstance | null> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const Kuroshiro = (await import('kuroshiro')).default;
      const KuromojiAnalyzer = (await import('kuroshiro-analyzer-kuromoji')).default;
      const kuroshiro = new Kuroshiro();
      // node_modules に同梱されている辞書を使う（public への配置は不要）
      const dictPath = path.join(process.cwd(), 'node_modules/kuromoji/dict');
      await kuroshiro.init(new KuromojiAnalyzer({ dictPath }));
      return kuroshiro;
    } catch (error) {
      console.error('Failed to initialize Kuroshiro on server:', error);
      // 失敗を握ったままだと再試行できないので次回のために捨てる
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

export async function POST(request: NextRequest) {
  let text: unknown;
  try {
    const body = await request.json();
    text = body?.text;
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 });
  }

  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'text は文字列で指定してください' }, { status: 400 });
  }

  const trimmed = text.trim();
  if (!trimmed) {
    // 空文字はウォームアップ用の呼び出し。ここで初期化を完了させる。
    // サーバーレスではレスポンス返却後のバックグラウンド処理が保証されないため
    // void ではなく await する。呼び出し側は応答を待たないので遅くても害はない。
    await getKuroshiro();
    return NextResponse.json({ hiragana: '' });
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: 'text が長すぎます' }, { status: 400 });
  }

  const kuroshiro = await getKuroshiro();
  if (!kuroshiro) {
    // 変換できなくてもフォームは手入力で先へ進めるので、200 + 空文字で返す。
    // 呼び出し側はふりがなが空なら何もしない。
    return NextResponse.json({ hiragana: '' });
  }

  try {
    const converted = await kuroshiro.convert(trimmed, { to: 'hiragana', mode: 'normal' });
    return NextResponse.json({ hiragana: converted.replace(/\s+/g, '') });
  } catch (error) {
    console.error('Failed to convert to hiragana:', error);
    return NextResponse.json({ hiragana: '' });
  }
}
