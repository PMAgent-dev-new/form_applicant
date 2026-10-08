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
    expect(applicationContextLines(c, now).join('\n')).toContain('記事流入元: 未特定');
    expect(applicationContextLines(c, now).join('\n')).toContain('集客元（直近確認）: 未特定');
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
  it('clearly separates media application route, article and preceding acquisition in Lark', () => {
    const landing = captureApplicationContext(input, {});
    const form = captureApplicationContext({ search: '?utm_source=ridejob_media&utm_medium=article_cta&utm_content=abc',
      url: 'https://ridejob.jp/entry/mechanic', referrer: 'https://ridejob.jp/media/blog/abc', now: now + 1000 }, landing);
    const lines = applicationContextLines(form, now + 1000).join('\n');
    expect(lines).toContain('応募経路: メディア経由');
    expect(lines).toContain('記事流入元: Facebook / 広告（計測値: fb / cpc）');
    expect(lines).toContain('元記事: 記事A');
    expect(lines).toContain('記事URL: https://ridejob.jp/media/blog/abc');
    expect(lines).toContain(`集客接触日時: ${new Date(now).toISOString()}`);
    expect(lines).toContain(`記事接触日時: ${new Date(now).toISOString()}`);
  });
  it('labels organic and unclassified Facebook visits without inventing paid acquisition', () => {
    const organic = captureApplicationContext({ ...input, search: '', referrer: 'https://www.google.com/search?q=private' }, {});
    expect(applicationContextLines(organic, now).join('\n')).toContain('Google / 自然検索');
    const facebook = captureApplicationContext({ ...input, search: '?fbclid=abc' }, {});
    const lines = applicationContextLines(facebook, now).join('\n');
    expect(lines).toContain('Facebook / 広告・自然流入の区別は未確認');
    expect(lines).not.toContain('Facebook / 広告（');
    const instagram = captureApplicationContext({ ...input, search: '?utm_source=instagram&utm_medium=organic' }, {});
    const instagramLines = applicationContextLines(instagram, now).join('\n');
    expect(instagramLines).toContain('Instagram / 自然流入');
    expect(instagramLines).not.toContain('Instagram / 自然検索');
  });
  it('does not claim media for a form without article or internal media evidence', () => {
    const direct = captureApplicationContext({ ...input, url: 'https://ridejob.jp/entry/mechanic' }, {});
    expect(applicationContextLines(direct, now).join('\n')).toContain('応募経路: 未特定（メディア経由か未確認）');
  });
  it('does not mistake an article view or an earlier visit for a media CTA or current article acquisition', () => {
    const earlier = captureApplicationContext(input, {});
    const later = captureApplicationContext({ ...input, search: '', now: now + 10000 }, earlier);
    const viewed = applicationContextLines(later, now + 10000).join('\n');
    expect(viewed).toContain('応募経路: 未特定（メディア記事の閲覧のみ確認）');
    expect(viewed).toContain('記事流入元: 未特定');
    expect(viewed).toContain('集客元（直近確認）: Facebook / 広告');
    const form = captureApplicationContext({ search: '?utm_source=ridejob_media&utm_medium=article_cta&utm_content=abc',
      url: 'https://ridejob.jp/entry/mechanic', referrer: '', now: now + 20000 }, later);
    const lines = applicationContextLines(form, now + 20000).join('\n');
    expect(lines).toContain('応募経路: メディア経由');
    expect(lines).toContain('記事流入元: 未特定');
    expect(lines).toContain('今回の記事への流入元と一致するとは限りません');
  });
  it('does not claim an article acquisition when touch order is reversed or article time is absent', () => {
    const context = { acquisition: { source: 'fb', medium: 'cpc', landing: input.url, at: new Date(now + 1000).toISOString() },
      entry: { source: 'ridejob_media', medium: 'article_cta', at: new Date(now + 2000).toISOString() },
      article: { id: 'abc', url: input.url, at: new Date(now).toISOString() } };
    const lines = applicationContextLines(context, now + 2000).join('\n');
    expect(lines).toContain('記事流入元: 未特定');
    expect(lines).not.toContain('記事流入元: Facebook');
    expect(applicationContextLines({ ...context, article: { id: 'abc', url: input.url } }, now + 2000).join('\n')).toContain('記事流入元: 未特定');
  });
});
