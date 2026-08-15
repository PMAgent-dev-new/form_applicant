import type { Metadata } from 'next';

// `export { default } from` は default しか運ばない（名前付き export の metadata は
// 再エクスポートされない）ため、画面はルートと同一でも metadata はここに書く必要がある。
export const metadata: Metadata = {
  title: 'タクシー運転手の転職ならライドジョブ｜応募フォーム',
};

export { default } from '../page';
