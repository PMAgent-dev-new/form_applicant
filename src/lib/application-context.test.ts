import { describe, expect, it } from 'vitest';
import { captureApplicationContext, normalizeApplicationContext, applicationContextLines, CONTEXT_WINDOW_MS } from './application-context';
const now = Date.parse('2026-10-08T01:00:00Z');
const input = { search: '?utm_source=fb&utm_medium=cpc&utm_id=52621818563839&utm_content=CR-2609-16', url: 'https://ridejob.jp/media/blog/abc', referrer: '', title: '記事A', now };
describe('application context shared contract', () => {
  it('retains the exact ad through an internal article CTA', () => {
    const landing = captureApplicationContext(input, {});
    const form = captureApplicationContext({ search: '?utm_source=ridejob_media&utm_medium=article_cta&utm_content=abc', url: 'https://ridejob.jp/entry/mechanic', referrer: '', now: now + 1000 }, landing);
    expect(form.acquisition?.id).toBe('52621818563839');
    expect(form.entry?.medium).toBe('article_cta');
    expect(form.article?.title).toBe('記事A');
  });
  it('preserves search referrer, while internal referrers do not replace it', () => {
    const organic = captureApplicationContext({ ...input, search: '', referrer: 'https://www.google.com/search?q=private' }, {});
    const form = captureApplicationContext({ ...input, search: '?utm_source=ridejob_media&utm_medium=article_cta&utm_content=abc', referrer: '' }, organic);
    expect(form.acquisition?.source).toBe('google');
    expect(form.acquisition?.medium).toBe('organic');
    expect(form.acquisition?.referrer).toBe('https://www.google.com');
  });
  it('does not invent an acquisition for an internal CTA with no preceding evidence', () => {
    const c = captureApplicationContext({ ...input, search: '?utm_source=ridejob_media&utm_medium=article_cta&utm_content=abc' }, {});
    expect(c.acquisition).toBeUndefined();
    expect(applicationContextLines(c, now)[0]).toContain('未特定');
  });
  it('rejects stale/future acquisition, foreign URLs and nonnumeric ad ids', () => {
    expect(normalizeApplicationContext({ acquisition: { source: 'fb', at: new Date(now - CONTEXT_WINDOW_MS - 1).toISOString(), id: '12345' } }, now).acquisition).toBeUndefined();
    expect(normalizeApplicationContext({ acquisition: { source: 'fb', at: new Date(now + 300001).toISOString() } }, now).acquisition).toBeUndefined();
    const c = normalizeApplicationContext({ acquisition: { source: 'fb', at: input.now && new Date(now).toISOString(), id: '{{ad.id}}', landing: 'https://evil.example/' } }, now);
    expect(c.acquisition?.id).toBeUndefined();
    expect(c.acquisition?.landing).toBeUndefined();
  });
  it('does not call a Facebook click id a paid ad', () => {
    const c = captureApplicationContext({ ...input, search: '?fbclid=abc' }, {});
    expect(c.acquisition?.medium).toBe('unknown');
    expect(c.acquisition?.id).toBeUndefined();
  });
  it('clears a previous article on a different internal CTA', () => {
    const article = captureApplicationContext(input, {});
    const other = captureApplicationContext({ ...input, url: 'https://ridejob.jp/entry/mechanic', search: '?utm_source=ridejob&utm_medium=header' }, article);
    expect(other.article).toBeUndefined();
    expect(other.acquisition?.id).toBe(article.acquisition?.id);
  });
  it('does not reuse the title of a different article or fabricate absent URLs', () => {
    const first = captureApplicationContext(input, {});
    const second = captureApplicationContext({ ...input, url: 'https://ridejob.jp/entry/mechanic', search: '?utm_source=ridejob_media&utm_medium=article_cta&utm_content=other' }, first);
    expect(second.article?.title).toBeUndefined();
    expect(second.article?.url).toContain('/other');
    expect(normalizeApplicationContext({ acquisition: { source: 'fb', at: new Date(now).toISOString() } }, now).acquisition?.landing).toBeUndefined();
  });
});
