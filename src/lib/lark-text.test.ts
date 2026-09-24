import { describe, expect, it } from 'vitest';

import { neutralizeLarkTags } from './lark-text';

describe('neutralizeLarkTags', () => {
  it('全員メンションを文字として表示される形にする', () => {
    expect(neutralizeLarkTags('<at user_id="all">所有人</at>')).toBe('＜at user_id="all"＞所有人＜/at＞');
  });

  it('タグを含まない文字列はそのまま、二重にかけても変わらない', () => {
    const text = '氏名: 山田 太郎 (やまだ)\n電話番号: 090-1234-5678';
    expect(neutralizeLarkTags(text)).toBe(text);
    expect(neutralizeLarkTags(neutralizeLarkTags('<b>'))).toBe('＜b＞');
  });
});
