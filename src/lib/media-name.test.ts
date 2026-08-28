import { describe, expect, it } from 'vitest';
import { describeMedia, displaySource, getMediaName } from './media-name';

describe('getMediaName', () => {
  it('utm_source が無ければ直接アクセス', () => {
    expect(getMediaName({})).toBe('直接アクセス');
    expect(getMediaName({ utm_medium: 'cpc' })).toBe('直接アクセス');
  });

  describe('ChatGPT', () => {
    it('広告クリックは medium の表記ゆれを吸収して ChatGPT広告', () => {
      expect(getMediaName({ utm_source: 'openai', utm_medium: 'cpc' })).toBe('ChatGPT広告');
      expect(getMediaName({ utm_source: 'openai', utm_medium: 'ad' })).toBe('ChatGPT広告');
      expect(getMediaName({ utm_source: 'openai', utm_medium: 'CPC' })).toBe('ChatGPT広告');
    });

    it('回答内引用からの自然流入は ChatGPT（広告と混ぜない）', () => {
      expect(getMediaName({ utm_source: 'chatgpt.com', utm_medium: 'referral' })).toBe('ChatGPT');
      expect(getMediaName({ utm_source: 'chat.openai.com', utm_medium: 'referral' })).toBe('ChatGPT');
      expect(getMediaName({ utm_source: 'openai' })).toBe('ChatGPT');
    });
  });

  describe('既存チャネルの回帰', () => {
    it.each([
      [{ utm_source: 'meta', utm_medium: 'ad' }, 'Meta広告'],
      [{ utm_source: 'meta', utm_medium: 'organic' }, 'Meta'],
      [{ utm_source: 'google', utm_medium: 'search' }, 'Googleリスティング'],
      [{ utm_source: 'google', utm_medium: 'organic' }, 'Google'],
      [{ utm_source: 'tiktok', utm_medium: 'ad' }, 'TikTok広告'],
      [{ utm_source: 'tiktok', utm_medium: 'organic' }, 'TikTokオーガニック'],
      [{ utm_source: 'youtube.com', utm_medium: 'referral' }, 'YouTube'],
      [{ utm_source: 'youtube', utm_medium: 'organic' }, 'YouTubeオーガニック'],
      [{ utm_source: 'threads', utm_medium: 'organic' }, 'スレッドオーガニック'],
    ])('%o → %s', (params, expected) => {
      expect(getMediaName(params)).toBe(expected);
    });
  });

  describe('壊れた入力でも落とさない（応募を500にしない）', () => {
    it('utm_medium が文字列でなくても例外を投げない', () => {
      // リクエストボディ由来なので型は当てにならない。ここで throw すると
      // route.ts の外側 catch に飛び、Base書き込み・通知・メール・SMS が全て実行されない。
      const params = { utm_source: 'openai', utm_medium: 123 } as unknown as { utm_source?: string; utm_medium?: string };
      expect(() => getMediaName(params)).not.toThrow();
      // 123 は広告 medium ではないので非広告扱い。ここでの要件は「落ちないこと」。
      expect(getMediaName(params)).toBe('ChatGPT');
    });

    it('utm_source が文字列でなくても例外を投げない', () => {
      const params = { utm_source: 123 } as unknown as { utm_source?: string };
      expect(() => getMediaName(params)).not.toThrow();
      expect(getMediaName(params)).toBe('123');
    });
  });

  it('入稿URLのコピペで混じる前後空白を吸収する', () => {
    expect(getMediaName({ utm_source: 'openai', utm_medium: ' cpc ' })).toBe('ChatGPT広告');
  });

  it('openai の非広告 medium は広告に寄せない', () => {
    expect(getMediaName({ utm_source: 'openai', utm_medium: 'organic' })).toBe('ChatGPT');
    expect(getMediaName({ utm_source: 'openai', utm_medium: 'search' })).toBe('ChatGPT');
  });

  it('source の大文字表記も同じ媒体に寄せる', () => {
    expect(getMediaName({ utm_source: 'OpenAI', utm_medium: 'cpc' })).toBe('ChatGPT広告');
    expect(getMediaName({ utm_source: 'ChatGPT.com', utm_medium: 'referral' })).toBe('ChatGPT');
  });

  it('未知の流入元は source(medium) のまま出す', () => {
    expect(getMediaName({ utm_source: 'indeed', utm_medium: 'cpc' })).toBe('indeed(cpc)');
    expect(getMediaName({ utm_source: 'example.com' })).toBe('example.com');
  });
});

describe('displaySource', () => {
  it('ホスト名を表示用の語彙へ寄せる', () => {
    expect(displaySource('youtu.be')).toBe('youtube');
    expect(displaySource('chatgpt.com')).toBe('openai');
  });

  it('未知のホストはそのまま返す', () => {
    expect(displaySource('example.com')).toBe('example.com');
    expect(displaySource(undefined)).toBeUndefined();
  });
});

describe('describeMedia（チャット通知用）', () => {
  it('名前付きの媒体は medium を括弧で残す', () => {
    expect(describeMedia({ utm_source: 'meta', utm_medium: 'ad' })).toBe('Meta広告（ad）');
    expect(describeMedia({ utm_source: 'meta', utm_medium: 'cpc' })).toBe('Meta（cpc）');
    expect(describeMedia({ utm_source: 'openai', utm_medium: 'cpc' })).toBe('ChatGPT広告（cpc）');
  });

  it('未知の流入元は source(medium) 形式のまま二重に付けない', () => {
    expect(describeMedia({ utm_source: 'indeed', utm_medium: 'cpc' })).toBe('indeed(cpc)');
  });

  it('medium が無ければ媒体名だけ', () => {
    expect(describeMedia({ utm_source: 'openai' })).toBe('ChatGPT');
    expect(describeMedia({})).toBe('直接アクセス');
  });
});
