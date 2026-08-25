import { describe, expect, test } from 'vitest';

import { resolveUtmParams, touchFromReferrer, type Attribution } from './attribution';

/**
 * ここで守りたいのは2つだけ。
 *  1. UTMを持たない流入（YouTube・自然検索）が「直接アクセス」に落ちないこと
 *  2. 広告の帰属を1ミリも動かさないこと
 * 2が壊れるとCPAの数字が変わるので、こちらの方が事故として重い。
 */

const HOST = 'ridejob.jp';

describe('touchFromReferrer', () => {
  test('YouTubeからの流入を referral として拾う（今回の張り替えの本題）', () => {
    expect(touchFromReferrer('https://www.youtube.com/', HOST)).toEqual({
      source: 'youtube.com',
      medium: 'referral',
    });
  });

  test('検索エンジンは organic として正規化する', () => {
    expect(touchFromReferrer('https://www.google.co.jp/search?q=a', HOST)).toEqual({
      source: 'google',
      medium: 'organic',
    });
    expect(touchFromReferrer('https://search.yahoo.co.jp/search?p=a', HOST)).toEqual({
      source: 'yahoo',
      medium: 'organic',
    });
  });

  test('自ドメイン内の遷移は流入として数えない', () => {
    // フォームは複数ページに分かれているため、これが無いと
    // 自分自身からの referral が毎回記録され、本当の流入元を押し流す。
    expect(touchFromReferrer('https://ridejob.jp/jobs/tokyo', HOST)).toBeUndefined();
    expect(touchFromReferrer('https://ridejob.jp/entry', HOST)).toBeUndefined();
  });

  test('サブドメインも自ドメイン扱いにする', () => {
    expect(touchFromReferrer('https://ridejob.pmagent.jp/', 'pmagent.jp')).toBeUndefined();
  });

  test('www の有無で別ホスト扱いにしない', () => {
    expect(touchFromReferrer('https://www.ridejob.jp/media', HOST)).toBeUndefined();
    expect(touchFromReferrer('https://note.com/x', 'www.ridejob.jp')).toEqual({
      source: 'note.com',
      medium: 'referral',
    });
  });

  test('referrer が空・壊れている場合は direct のまま', () => {
    expect(touchFromReferrer('', HOST)).toBeUndefined();
    expect(touchFromReferrer('not a url', HOST)).toBeUndefined();
    expect(touchFromReferrer('about:blank', HOST)).toBeUndefined();
  });
});

describe('resolveUtmParams', () => {
  const noAttr: Attribution = {};

  test('queryのUTMが最優先（広告の帰属は絶対に動かさない）', () => {
    const r = resolveUtmParams(
      '?utm_source=meta&utm_medium=ad&utm_id=1234&utm_content=cr-9',
      { lastTouch: { source: 'google', medium: 'organic', at: 'x' } },
      'https://www.youtube.com/',
      HOST,
    );
    expect(r.utm_source).toBe('meta');
    expect(r.utm_medium).toBe('ad');
    expect(r.utm_id).toBe('1234');
    expect(r.utm_content).toBe('cr-9');
  });

  test('queryにUTMがある時、Cookieの値で穴埋めしない', () => {
    // 広告のsourceと過去の自然検索のcampaignが混ざった、実在しない組み合わせを作らないため。
    const r = resolveUtmParams(
      '?utm_source=meta',
      { lastTouch: { source: 'google', medium: 'organic', campaign: 'spring', at: 'x' } },
      '',
      HOST,
    );
    expect(r.utm_source).toBe('meta');
    expect(r.utm_medium).toBe('');
    expect(r.utm_campaign).toBe('');
  });

  test('queryが空ならCookieのlastTouchを使う（サイト内を回遊してから応募した経路）', () => {
    const r = resolveUtmParams(
      '',
      { lastTouch: { source: 'google', medium: 'organic', at: 'x' } },
      '',
      HOST,
    );
    expect(r.utm_source).toBe('google');
    expect(r.utm_medium).toBe('organic');
  });

  test('lastTouchが無ければfirstTouchを使う', () => {
    const r = resolveUtmParams('', { firstTouch: { source: 'note.com', medium: 'referral', at: 'x' } }, '', HOST);
    expect(r.utm_source).toBe('note.com');
  });

  test('queryもCookieも無ければreferrerから補う（Cookieがブロックされている環境の保険）', () => {
    const r = resolveUtmParams('', noAttr, 'https://www.youtube.com/', HOST);
    expect(r.utm_source).toBe('youtube.com');
    expect(r.utm_medium).toBe('referral');
  });

  test('どれも無ければ空のまま（従来どおり直接アクセス）', () => {
    const r = resolveUtmParams('', noAttr, '', HOST);
    expect(r.utm_source).toBe('');
    expect(r.utm_medium).toBe('');
  });

  test('自ドメインからの遷移だけの場合は空のまま', () => {
    const r = resolveUtmParams('', noAttr, 'https://ridejob.jp/entry', HOST);
    expect(r.utm_source).toBe('');
  });

  test('utm_source以外だけがqueryにある場合はCookieを優先する', () => {
    // utm_content だけ付いたリンクを踏んだケース。source が決まらないと
    // 流入元として使えないので、source を持っている Cookie 側を採用する。
    const r = resolveUtmParams(
      '?utm_content=banner-a',
      { lastTouch: { source: 'google', medium: 'organic', at: 'x' } },
      '',
      HOST,
    );
    expect(r.utm_source).toBe('google');
    expect(r.utm_content).toBe('banner-a');
  });

  test('7つのキーが必ず揃う（送信ボディの形を変えない）', () => {
    const r = resolveUtmParams('', noAttr, '', HOST);
    expect(Object.keys(r).sort()).toEqual(
      ['utm_campaign', 'utm_content', 'utm_creative', 'utm_id', 'utm_medium', 'utm_source', 'utm_term'].sort(),
    );
    expect(Object.values(r).every((v) => typeof v === 'string')).toBe(true);
  });

  test('空白だけのUTMは値なしとして扱う', () => {
    const r = resolveUtmParams(
      '?utm_source=%20%20',
      { lastTouch: { source: 'google', medium: 'organic', at: 'x' } },
      '',
      HOST,
    );
    expect(r.utm_source).toBe('google');
  });
});

describe('自ホスト判定のポート表記', () => {
  test('location.host にポートが付いていても自ドメインと判定する', () => {
    // 本番(ridejob.jp)はポートを持たないので挙動は変わらないが、
    // これが無いとローカル検証で自ドメイン遷移が referral として記録され、
    // 「動いている」と誤読してしまう。
    expect(touchFromReferrer('http://localhost/entry', 'localhost:3000')).toBeUndefined();
    expect(touchFromReferrer('https://ridejob.jp/', 'ridejob.jp:443')).toBeUndefined();
  });

  test('ポートが違っても別サイト扱いにはしない', () => {
    expect(touchFromReferrer('http://localhost:4000/', 'localhost:3000')).toBeUndefined();
  });
});
