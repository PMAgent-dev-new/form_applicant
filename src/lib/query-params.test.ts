import { describe, expect, it } from 'vitest';

import { clampCount, isMicrocmsId, parseMicrocmsIdList } from './query-params';

describe('isMicrocmsId', () => {
  it('英数字・ハイフン・アンダースコアの ID を通す', () => {
    expect(isMicrocmsId('13')).toBe(true);
    expect(isMicrocmsId('km-r2191rr5l')).toBe(true);
    expect(isMicrocmsId('tokyo_23')).toBe(true);
  });

  it('filters の演算子や区切りを含む値を通さない', () => {
    expect(isMicrocmsId('13[or]id[exists]')).toBe(false);
    expect(isMicrocmsId('13,14')).toBe(false);
    expect(isMicrocmsId('')).toBe(false);
    expect(isMicrocmsId(null)).toBe(false);
    expect(isMicrocmsId('a'.repeat(65))).toBe(false);
  });
});

describe('parseMicrocmsIdList', () => {
  it('未指定は空配列、正しい列は配列で返す', () => {
    expect(parseMicrocmsIdList(null)).toEqual([]);
    expect(parseMicrocmsIdList('13, 14')).toEqual(['13', '14']);
  });

  it('1つでも形式外なら null', () => {
    expect(parseMicrocmsIdList('13,14[or]x')).toBeNull();
  });

  it('上限を超える個数は null', () => {
    expect(parseMicrocmsIdList(Array.from({ length: 21 }, (_, i) => String(i)).join(','))).toBeNull();
  });
});

describe('clampCount', () => {
  it('未指定・数値でない値は既定値', () => {
    expect(clampCount(null, 3, 12)).toBe(3);
    expect(clampCount('abc', 3, 12)).toBe(3);
  });

  it('範囲外は 1..max に丸める', () => {
    expect(clampCount('0', 3, 12)).toBe(1);
    expect(clampCount('-5', 3, 12)).toBe(1);
    expect(clampCount('1000', 3, 12)).toBe(12);
    expect(clampCount('5', 3, 12)).toBe(5);
  });
});
