import { describe, expect, it } from 'vitest';
import { buildConversionEvent, hashEmail, hashPhone } from './capi';

const BASE = { eventId: 'evt-1', timestampMs: 1773892800000 };

describe('buildConversionEvent', () => {
  it('oppref があればイベントを組み立てる', () => {
    const e = buildConversionEvent({ ...BASE, oppref: 'gAAAAAb123', sourceUrl: 'https://ridejob.jp/entry' });
    expect(e).toEqual({
      id: 'evt-1',
      type: 'registration_completed',
      timestamp_ms: 1773892800000,
      action_source: 'web',
      data: { type: 'customer_action' },
      oppref: 'gAAAAAb123',
      source_url: 'https://ridejob.jp/entry',
    });
  });

  it('oppref を加工せずそのまま渡す（公式仕様）', () => {
    const raw = 'gAAAAAb123==/+x';
    expect(buildConversionEvent({ ...BASE, oppref: raw })?.oppref).toBe(raw);
  });

  it('突合材料が無い応募は送らない（null を返す）', () => {
    // 広告クリック由来でない応募。OpenAI 側でどのクリックにも紐づかず、
    // レポートに乗らないまま個人データだけが渡るのを避ける。
    expect(buildConversionEvent({ ...BASE, email: 'a@example.com', phone: '090-1234-5678' })).toBeNull();
  });

  it('既定では user（個人情報）を含めない', () => {
    const e = buildConversionEvent({ ...BASE, oppref: 'x', email: 'a@example.com', phone: '09012345678' });
    expect(e?.user).toBeUndefined();
  });
});

describe('ハッシュ化の正規化', () => {
  it('メールは trim + 小文字化してから SHA256', () => {
    expect(hashEmail('  Foo@Example.COM ')).toBe(hashEmail('foo@example.com'));
    expect(hashEmail('foo@example.com')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail('')).toBeUndefined();
    expect(hashEmail(undefined)).toBeUndefined();
  });

  it('国内表記の電話は国番号81を補ってから先頭0を落とす', () => {
    // 090-1234-5678 → 819012345678。81を補わないと 9012345678 になり別の国の番号として扱われる。
    expect(hashPhone('090-1234-5678')).toBe(hashPhone('819012345678'));
    expect(hashPhone('+81 90 1234 5678')).toBe(hashPhone('819012345678'));
    expect(hashPhone('(090) 1234.5678')).toBe(hashPhone('819012345678'));
  });

  it('桁数が範囲外なら送らない', () => {
    expect(hashPhone('123')).toBeUndefined();
    expect(hashPhone('0912345678901234567')).toBeUndefined();
    expect(hashPhone('')).toBeUndefined();
  });
});
