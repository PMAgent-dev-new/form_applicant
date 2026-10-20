import { describe, expect, it } from 'vitest';
import { mapJobTimingLabel } from './mapJobTimingLabel';

describe('mapJobTimingLabel', () => {
  it('「求人だけ見たい」を通常と整備士の両方で返す', () => {
    expect(mapJobTimingLabel('browse_only')).toBe('求人だけ見たい');
    expect(mapJobTimingLabel('browse_only', 'truck')).toBe('求人だけ見たい');
    expect(mapJobTimingLabel('browse_only', 'mechanic')).toBe('求人だけ見たい');
  });

  it('既存の選択肢の表示名は変えない', () => {
    expect(mapJobTimingLabel('asap')).toBe('決まれば早く転職したい');
    expect(mapJobTimingLabel('asap', 'mechanic')).toBe('なるべく早く');
    expect(mapJobTimingLabel('no_plan')).toBe('すぐに転職する気はない');
    expect(mapJobTimingLabel('')).toBe('');
  });
});
