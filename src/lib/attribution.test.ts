import { describe, expect, test } from 'vitest';

import { captureAttribution, readAttribution, resolveUtmParams, touchFromReferrer, type Attribution } from './attribution';

/**
 * ここで守りたいのは3つ。
 *  1. UTMを持たない流入（YouTube・自然検索）が「直接アクセス」に落ちないこと
 *  2. 有料の流入が「自然検索」に化けないこと
 *  3. 出所（query / Cookie / referrer）を混ぜて、実在しない流入を作らないこと
 *
 * 2と3が壊れると、SEO成果の判断に使う自然検索の数字が汚れる。1が取れないより重い。
 * なお「広告の帰属が変わらない」のは**着地1件の解釈**の話で、応募1件の帰属は
 * Cookie のぶん変わりうる（詳細は attribution.ts の docコメント）。
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

  test('queryのUTMが最優先（着地1件の解釈は変えない）', () => {
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

  test('utm_source が無いとき、queryの断片とCookieを混ぜない', () => {
    // 混ぜると「先週の自然検索の source」と「今日のリンクの medium」が同じレコードに並び、
    // 実在しない流入が1件できあがる。出所は3つのうち1つを丸ごと採る。
    const r = resolveUtmParams(
      '?utm_medium=cpc&utm_content=banner-a',
      { lastTouch: { source: 'google', medium: 'organic', at: 'x' } },
      '',
      HOST,
    );
    expect(r.utm_source).toBe('google');
    expect(r.utm_medium).toBe('organic'); // queryの cpc は混ぜない
    expect(r.utm_content).toBe('');       // queryの banner-a も混ぜない
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


describe('クリックIDだけの有料クリック（レビュー指摘1の回帰防止）', () => {
  test('gclidのみのGoogle広告が「自然検索」に化けない', () => {
    // Google広告の自動タグ設定は既定で gclid だけを付ける。その着地の referrer は
    // 検索結果ページなので、素直に referrer 推定すると organic になってしまう。
    // 自然検索の応募数はSEO成果の判断に使う数字で、有料が混ざると判断を誤る。
    const r = resolveUtmParams('?gclid=EAIaIQ', {}, 'https://www.google.com/', HOST);
    expect(r.utm_source).toBe('');
    expect(r.utm_medium).toBe('');
  });

  test('fbclid付きのMeta広告が「参照」に化けない', () => {
    const r = resolveUtmParams('?utm_content=CR-9&fbclid=abc', {}, 'https://l.facebook.com/', HOST);
    expect(r.utm_source).toBe('');
    expect(r.utm_content).toBe('CR-9'); // 広告名は落とさない
  });

  test('クリックIDがあるときはCookieにも落ちない', () => {
    const r = resolveUtmParams(
      '?gclid=EAIaIQ',
      { lastTouch: { source: 'google', medium: 'organic', at: 'x' } },
      '',
      HOST,
    );
    expect(r.utm_source).toBe('');
  });

  test('opprefのみのChatGPT広告が「ChatGPT自然流入」に化けない', () => {
    // ChatGPT広告のクリックは oppref が自動付与される。UTMを付け忘れた／中間リダイレクトで
    // 脱落した場合、referrer は chatgpt.com なので推定に落とすと自然流入として記録され、
    // 広告費がAIOの成果に混入する。
    const r = resolveUtmParams('?oppref=gAAAAAb123', {}, 'https://chatgpt.com/', HOST);
    expect(r.utm_source).toBe('');
    expect(r.utm_medium).toBe('');
  });

  test('utm_source があれば従来どおりそれが勝つ（gclid併用でも）', () => {
    const r = resolveUtmParams('?utm_source=google&utm_medium=cpc&gclid=X', {}, '', HOST);
    expect(r.utm_source).toBe('google');
    expect(r.utm_medium).toBe('cpc');
  });
});

describe('ネイティブアプリからの流入（レビュー指摘2の回帰防止）', () => {
  test('AndroidのYouTubeアプリが「Google自然検索」にならない', () => {
    // パッケージ名 com.google.android.youtube が検索エンジン判定の
    // /(^|\.)google\./ にマッチしてしまい、本PRの目的である
    // YouTube流入が自然検索KPIを汚染する側に回っていた。
    expect(touchFromReferrer('android-app://com.google.android.youtube/', HOST)).toEqual({
      source: 'youtube.com',
      medium: 'referral',
    });
  });

  test('PCブラウザ経由と同じ値に揃える（集計で行が割れない）', () => {
    const app = touchFromReferrer('android-app://com.google.android.youtube/', HOST);
    const web = touchFromReferrer('https://www.youtube.com/', HOST);
    expect(app).toEqual(web);
  });

  test('Google検索アプリは organic のまま', () => {
    expect(touchFromReferrer('android-app://com.google.android.googlequicksearchbox/', HOST)).toEqual({
      source: 'google',
      medium: 'organic',
    });
  });

  test('Gmailアプリは自然検索ではなく referral', () => {
    expect(touchFromReferrer('android-app://com.google.android.gm/', HOST)).toEqual({
      source: 'gmail',
      medium: 'referral',
    });
  });

  test('未知のアプリはパッケージ名のまま referral（嘘をつかない）', () => {
    expect(touchFromReferrer('android-app://com.example.unknown/', HOST)).toEqual({
      source: 'com.example.unknown',
      medium: 'referral',
    });
  });
});

describe('壊れたCookieでフォームを殺さない（レビュー指摘4の回帰防止）', () => {
  const withCookies = (raw: string, fn: () => void) => {
    const g = globalThis as unknown as { document?: { cookie: string } };
    const had = 'document' in g;
    const prev = g.document;
    g.document = { cookie: raw };
    try { fn(); } finally { if (had) g.document = prev; else delete g.document; }
  };

  test('不正な%を含むCookieが混ざっても throw しない', () => {
    // ridejob.jp のCookieはこのアプリだけが書いているわけではない（GTM経由の計測タグ多数）。
    // 他人が書いた1本で decodeURIComponent が URIError を投げると、
    // effect の未捕捉例外になり、そのユーザーはフォームを一切使えなくなる。
    withCookies('broken=100%zz; rj_attr=' + encodeURIComponent(JSON.stringify({
      lastTouch: { source: 'google', medium: 'organic', at: 'x' },
    })), () => {
      expect(() => readAttribution()).not.toThrow();
      expect(readAttribution().lastTouch?.source).toBe('google');
    });
  });

  test('rj_attr 自体が壊れていても throw しない', () => {
    withCookies('rj_attr=%7Bnot-json', () => {
      expect(() => readAttribution()).not.toThrow();
      expect(readAttribution()).toEqual({});
    });
  });
});

describe('captureAttribution が既存の帰属を壊さない', () => {
  const run = (initial: string, fn: (getCookie: () => string) => void) => {
    const g = globalThis as unknown as { document?: { cookie: string } };
    const had = 'document' in g;
    const prev = g.document;
    const jar = new Map<string, string>();
    for (const c of initial ? initial.split('; ') : []) {
      const i = c.indexOf('='); if (i > 0) jar.set(c.slice(0, i), c.slice(i + 1));
    }
    g.document = {
      get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
      set cookie(v: string) { const p = v.split(';')[0]; const i = p.indexOf('='); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); },
    } as { cookie: string };
    try { fn(() => (g.document as { cookie: string }).cookie); }
    finally { if (had) g.document = prev; else delete g.document; }
  };

  test('既存の広告タッチを、後から来た自然検索で上書きしない', () => {
    // ここが有料の帰属を守る核心。壊れるとCPAの数字が動く。
    const existing = encodeURIComponent(JSON.stringify({
      firstTouch: { source: 'meta', medium: 'ad', at: '2026-08-01T00:00:00Z' },
      lastTouch: { source: 'meta', medium: 'ad', at: '2026-08-01T00:00:00Z' },
    }));
    run(`rj_attr=${existing}`, () => {
      const after = captureAttribution('', '/taxi', 'https://www.google.co.jp/search?q=a', '2026-08-25T00:00:00Z', HOST);
      expect(after.lastTouch?.source).toBe('meta');
      expect(after.firstTouch?.source).toBe('meta');
    });
  });

  test('タッチが無ければ referrer から記録する', () => {
    run('', (getCookie) => {
      const after = captureAttribution('', '/taxi', 'https://www.youtube.com/', '2026-08-25T00:00:00Z', HOST);
      expect(after.lastTouch).toEqual({ source: 'youtube.com', medium: 'referral', at: '2026-08-25T00:00:00Z' });
      expect(getCookie()).toContain('rj_attr=');
    });
  });

  test('UTM付きの着地は lastTouch を更新し firstTouch は保つ', () => {
    const existing = encodeURIComponent(JSON.stringify({
      firstTouch: { source: 'youtube.com', medium: 'referral', at: '2026-08-01T00:00:00Z' },
      lastTouch: { source: 'youtube.com', medium: 'referral', at: '2026-08-01T00:00:00Z' },
    }));
    run(`rj_attr=${existing}`, () => {
      const after = captureAttribution('?utm_source=meta&utm_medium=ad', '/taxi', '', '2026-08-25T00:00:00Z', HOST);
      expect(after.firstTouch?.source).toBe('youtube.com');
      expect(after.lastTouch?.source).toBe('meta');
    });
  });
});
