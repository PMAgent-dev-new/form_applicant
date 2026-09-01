import { describe, expect, it } from 'vitest';
import { resolveApplicationSourceMasterName, resolveJobCategoryMasterName } from './lark-masters';

describe('resolveApplicationSourceMasterName', () => {
  // 2026-09-01 に求職者DB🚕の実レコードから作った表。営業の実入力と一致することを確認済み。
  it.each([
    ['meta', 'ad', 'meta(ad)'],
    ['meta', 'cpc', 'meta(ad)'],
    ['fb', 'ad', 'fb(ad)'],
    ['fb', 'cpc', 'fb(ad)'],
    ['ig', 'ad', 'ig(ad)'],
    ['ig', 'cpc', 'ig(ad)'],
    ['th', 'ad', 'th(ad)'],
    ['tiktok', 'ad', 'tiktok(ad)'],
    ['google', 'cpc', 'google(ad)'],
    ['google', 'search', 'google(ad)'],
    ['google', 'organic', 'google(organic)'],
    ['stanby', 'cpc', 'スタンバイ'],
  ])('utm_source=%s / utm_medium=%s → %s', (utm_source, utm_medium, expected) => {
    expect(resolveApplicationSourceMasterName({ utm_source, utm_medium })).toBe(expected);
  });

  // fb と ig は面談率が2倍以上違うため、Meta としてまとめてはいけない。
  it('FacebookとInstagramは配置別のまま分けて紐付ける', () => {
    expect(resolveApplicationSourceMasterName({ utm_source: 'facebook', utm_medium: 'ad' })).toBe('fb(ad)');
    expect(resolveApplicationSourceMasterName({ utm_source: 'instagram', utm_medium: 'ad' })).toBe('ig(ad)');
  });

  it('入稿URLのコピペで混ざる大文字・前後の空白を吸収する', () => {
    expect(resolveApplicationSourceMasterName({ utm_source: ' FB ', utm_medium: ' CPC ' })).toBe('fb(ad)');
  });

  it('utm_source が無い応募は RIDEJOB HP', () => {
    expect(resolveApplicationSourceMasterName({})).toBe('RIDEJOB HP');
    expect(resolveApplicationSourceMasterName({ utm_medium: 'referral' })).toBe('RIDEJOB HP');
  });

  // Meta のオーガニックは配置別（fb/ig/th）で持っており、マスタに meta(organic) は存在しない。
  it('マスタに存在しないオーガニック名は作らない', () => {
    expect(resolveApplicationSourceMasterName({ utm_source: 'meta', utm_medium: 'organic' })).toBeUndefined();
    expect(resolveApplicationSourceMasterName({ utm_source: 'fb', utm_medium: 'organic' })).toBe('fb(organic)');
  });

  it('未知の流入元・未知のmediumは undefined（空欄のまま残す）', () => {
    expect(resolveApplicationSourceMasterName({ utm_source: 'e2e-test', utm_medium: 'test' })).toBeUndefined();
    // 求人ボックスからのreferralは kbox/feed と kbox/採用ボード のどちらか判別できないため書かない。
    expect(
      resolveApplicationSourceMasterName({ utm_source: '求人ボックス.com', utm_medium: 'referral' })
    ).toBeUndefined();
    expect(resolveApplicationSourceMasterName({ utm_source: 'fb', utm_medium: 'referral' })).toBeUndefined();
  });
});

describe('resolveJobCategoryMasterName', () => {
  const base = { isTaxi: false, isTruck: false, isBus: false };

  it('トラック・バスはLPどおりの職種', () => {
    expect(resolveJobCategoryMasterName({ ...base, isTruck: true })).toBe('トラックドライバー');
    expect(resolveJobCategoryMasterName({ ...base, isBus: true })).toBe('バスドライバー');
  });

  it('タクシーLPはクリエイティブでタクシー／ハイヤーを振り分ける', () => {
    expect(
      resolveJobCategoryMasterName({ ...base, isTaxi: true, utmCreative: 'CR-2607-09_TAXI_動画B_LP版' })
    ).toBe('タクシードライバー');
    expect(
      resolveJobCategoryMasterName({ ...base, isTaxi: true, utmCreative: 'CR-2607-04_TAXI_ハイヤー転向原本' })
    ).toBe('ハイヤー/役員専属運転手');
  });

  // Google広告はクリエイティブ名が付かない。実績でもタクシーが多数なのでタクシー側に寄せる。
  it('クリエイティブが無いタクシーLP応募はタクシードライバー', () => {
    expect(resolveJobCategoryMasterName({ ...base, isTaxi: true })).toBe('タクシードライバー');
  });

  it('どのLPとも判定できない応募には職種を付けない', () => {
    expect(resolveJobCategoryMasterName({ ...base, utmCreative: 'CR-2607-02_TAXI_ハイヤー転向' })).toBeUndefined();
  });
});
