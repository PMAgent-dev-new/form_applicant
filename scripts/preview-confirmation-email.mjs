// 応募受付完了メールのHTML/テキストをローカルで確認するためのプレビュースクリプト
// 使い方: node scripts/preview-confirmation-email.mjs
// → /tmp に preview-{origin}.html が書き出され、open コマンドで開く

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// TypeScript を直接 import するため tsx を経由する想定。ない場合は ts-node にフォールバック。
// このスクリプトは `node --import tsx scripts/preview-confirmation-email.mjs` で実行する。

const mod = await import('../src/lib/email/templates/application-confirmation.ts');
const { buildApplicationConfirmationHtml, buildApplicationConfirmationText } = mod;

const samples = [
  {
    label: 'default (RIDE JOB)',
    file: 'preview-ridejob.html',
    input: {
      applicantName: '矢野 輝',
      applicantNameKana: 'やの ひかる',
      phoneNumber: '090-1234-5678',
      email: 'sample.applicant@example.com',
      formOrigin: 'default',
    },
  },
  {
    label: 'mechanic',
    file: 'preview-mechanic.html',
    input: {
      applicantName: '田中 太郎',
      applicantNameKana: 'たなか たろう',
      phoneNumber: '080-9876-5432',
      email: 'mechanic.applicant@example.com',
      formOrigin: 'mechanic',
    },
  },
  {
    label: 'coupang (ロケットナウ 営業職)',
    file: 'preview-coupang.html',
    input: {
      applicantName: 'テスト　太郎',
      applicantNameKana: 'てすとたろう',
      phoneNumber: '090-1234-5678',
      email: 'coupang.applicant@example.com',
      formOrigin: 'coupang',
    },
  },
];

const out = tmpdir();
for (const s of samples) {
  const html = buildApplicationConfirmationHtml(s.input);
  const text = buildApplicationConfirmationText(s.input);
  const htmlPath = join(out, s.file);
  const textPath = join(out, s.file.replace('.html', '.txt'));
  writeFileSync(htmlPath, html, 'utf8');
  writeFileSync(textPath, text, 'utf8');
  console.log(`[${s.label}]`);
  console.log(`  HTML: ${htmlPath}`);
  console.log(`  TEXT: ${textPath}`);
}

console.log('\nmacOS で開く: `open ' + join(out, samples[0].file) + '`');
