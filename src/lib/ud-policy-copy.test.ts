import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_VERSION } from './privacy-consent';

describe('UD内の広告タグなしポリシー表示', () => {
  it('同意版を変更した場合はコピーの照合も必須にする', () => {
    expect(PRIVACY_POLICY_VERSION).toBe('v4-2026-11-05');
    const source = readFileSync('src/app/ud-manufacturing/policy/page.tsx', 'utf8');
    const text = source.slice(source.indexOf('{/* Intro */}'), source.indexOf('</ol>'))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<[^>]+>/g, '').replace(/\s/g, '');
    // jobmadley @ cd18e8569f94b7ee695ee1b70a2b8be642935454 の本文を同手順で照合。
    expect(createHash('sha256').update(text).digest('hex')).toBe('421268f0e6d21835c047c89066baeed17ab204dbcff181c02871efbc9062e3a9');
  });
});
