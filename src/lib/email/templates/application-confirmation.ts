/**
 * RIDE JOB / RIDE JOBメカニック 応募者向け 自動配信メール テンプレート
 *
 * デザイン: AIDMA Academy 風 ──「MESSAGE ─── RIDE JOBより」の小見出し、
 *           ゴールド(#a18a5c)アクセント、黒の CTA ボタン、ベージュ系のトーン。
 *
 * 文面はフォーム種別ごとに差し替え可能。
 * 編集する場合は下の RIDEJOB_CONTENT / MECHANIC_CONTENT を直接書き換えてください。
 *
 *   - default / bus              → RIDEJOB_CONTENT   (タクシー転職 訴求)
 *   - truck                       → TRUCK_CONTENT    (トラック転職 訴求)
 *   - mechanic / mechanic_newgrad → MECHANIC_CONTENT (整備士転職 訴求)
 *
 * 共通のレイアウト (見出し / CTAボタン / 注意書き / フッター) は本ファイル下部の
 * buildHtml / buildText 内で組み立てています。コピーだけ変えたい場合は触らなくてOK。
 */

import type { EmailFormOrigin } from '../types';

// ──────────────────────────────────────────
// 公開型
// ──────────────────────────────────────────

export type BrandConfig = {
  /** 本文中で参照するブランド名 (greetingで "${brandName}へのご登録..." に展開) */
  brandName: string;
  /** 送信者表示名 (From ヘッダー) */
  fromName: string;
  /** 件名 */
  subject: string;
  /** CTA (面談予約) のURL */
  bookingUrl: string;
};

// ──────────────────────────────────────────
// メール本文 (フォーム種別ごとに差し替え可能)
// ──────────────────────────────────────────

/** CTA ブロックの後に続く求人紹介セクション (任意) の 1 求人ぶん。 */
type JobListing = {
  /** 見出し (テンプレート側で 【】 を自動付与。例: '1 業界最高水準の給与') */
  title: string;
  /** 給与行 (\n で改行可) */
  salary: string;
  /** 特徴行 (\n で改行可) */
  feature: string;
};

type MailContent = BrandConfig & {
  /**
   * 挨拶文の「株式会社PM Agentです。」に続く一文。
   * 未指定なら `${brandName}へのご登録ありがとうございます。` を自動生成。
   */
  greetingLine?: string;
  /**
   * 本文の段落配列。
   * 文字列内の `\n` は HTML では `<br>`、テキスト版では改行として展開される。
   * 段落と段落の間は自動で空行が入る。
   */
  bodyParagraphs: string[];
  /** CTA ブロックの太字リード (\n で改行可) */
  ctaHeading: string;
  /** CTA ブロックのサブテキスト (\n で改行可) */
  ctaSubheading: string;
  /** CTA ボタンのラベル (右矢印は自動付与) */
  ctaButtonLabel: string;
  /**
   * 「※すでに面談をご予約済みの方にも〜」の注意書きを表示するか。
   * 未指定 (=true) で表示。RIDE JOB のように出さない場合は false。
   */
  showBookingNote?: boolean;
  /** CTA ブロックの後に続く求人紹介セクション (任意) */
  jobSection?: {
    /** 「＼ 今ご紹介できるイチオシ求人をチラ見せ ／」等の見出し行 */
    heading: string;
    /** 見出し下のリード文 (任意) */
    lead?: string;
    listings: JobListing[];
  };
  /** 求人セクションの後に続く締めの段落 (任意, \n で改行可) */
  closingParagraphs?: string[];
  /** フッターに表示する電話番号 (任意) */
  phone?: string;
};

// ─── RIDE JOB (タクシー: default + bus) ────────────────
const RIDEJOB_CONTENT: MailContent = {
  brandName: 'RIDE JOB',
  fromName: 'RIDE JOB',
  subject: '【限定公開】あなたに合ったドライバーの「好条件求人」を一部お届けします',
  bookingUrl: 'https://leomeet.pmagent.jp/book/ride',
  greetingLine: 'ドライバーのお仕事探しRIDE JOBへのご登録ありがとうございます。',
  bodyParagraphs: [
    '「まずは求人を見てみたい」と思われたところ、すぐに一覧をお見せできず申し訳ありません。',
    '実は、ドライバー業界には「給与保障が高く、稼げる好条件求人」が多数ありますが、ご自身の希望の働き方や適性によって、一番ご活躍いただける会社が異なります。そのため、ネット上の情報だけで判断していただくのではなく、直接お話しして最適な求人をご案内する形をとっております。',
  ],
  ctaHeading:
    'そこで、あなたのご希望に合う求人があるかを【10分〜20分の気軽なお電話（またはオンライン）】でサクッと確認できる時間をご用意しました。',
  ctaSubheading:
    '無理な転職の強要は一切ありません。\nまずは以下のリンクから、お気軽に都合の良い日時をお選びください。',
  ctaButtonLabel: '【1分で完了】ご希望の日時をこちらから選ぶ',
  showBookingNote: false,
  jobSection: {
    heading: '＼ 今ご紹介できるイチオシ求人をチラ見せ ／',
    lead: '以下のような好条件求人をたくさんご用意しています。',
    listings: [
      {
        title: '1 業界最高水準の給与',
        salary: '平均月収50万円＋賞与年３回！年収1000万も目指せる！',
        feature: '二種免許は会社負担でOK！隔日・日勤・夜勤が選べる！',
      },
      {
        title: '2 高級ハイヤー',
        salary: '年収600〜900万円、未経験の方は3ヶ月40万円の給与保証あり',
        feature:
          '高級車でVIP顧客・インバウンド旅行者を送迎\n流し営業は一切なし！月18~19日休みも可能！',
      },
      {
        title: '3 大手グループ・福利厚生充実',
        salary: '平均月収50万円以上、福利厚生充実！',
        feature:
          '社会保険完備＆社員寮あり！研修＆二種免許取得支援あり 大手ならではのキャリアアップ制度あり！月11乗務（標準パターン）',
      },
    ],
  },
  closingParagraphs: [
    'ここだけの「リアルな本音」、ちょっと聞いてみませんか？',
    '「一番稼げる会社はどこ？」「労働時間は本当にきつくない？」など、ネットの検索では出てこない業界の裏事情を、10分〜20分の電話（またはオンライン）でこっそりお伝えします。',
    '「まずは情報収集だけしたい」「話を聞いてみたい」という動機で全く問題ありません。\n履歴書も不要ですので、ぜひ上のURLからお気軽にご予約ください。\nご予約をお待ちしています。',
  ],
  phone: '03-6692-0477',
};

// ─── RIDE JOB (トラック: truck) ────────────────────────
// ⚠️ TODO: 運用側(小笠原さん)確認前の仮版。共通文はRIDEJOB_CONTENTと同一で、
//    求人チラ見せのみフィード実在のトラック求人(2026-08時点)に差し替えている。
const TRUCK_CONTENT: MailContent = {
  brandName: 'RIDE JOB',
  fromName: 'RIDE JOB',
  subject: '【限定公開】あなたに合ったトラックドライバーの「好条件求人」を一部お届けします',
  bookingUrl: 'https://leomeet.pmagent.jp/book/ride',
  greetingLine: 'ドライバーのお仕事探しRIDE JOBへのご登録ありがとうございます。',
  bodyParagraphs: [
    '「まずは求人を見てみたい」と思われたところ、すぐに一覧をお見せできず申し訳ありません。',
    '実は、ドライバー業界には「給与保障が高く、稼げる好条件求人」が多数ありますが、ご自身の希望の働き方や適性によって、一番ご活躍いただける会社が異なります。そのため、ネット上の情報だけで判断していただくのではなく、直接お話しして最適な求人をご案内する形をとっております。',
  ],
  ctaHeading:
    'そこで、あなたのご希望に合う求人があるかを【10分〜20分の気軽なお電話（またはオンライン）】でサクッと確認できる時間をご用意しました。',
  ctaSubheading:
    '無理な転職の強要は一切ありません。\nまずは以下のリンクから、お気軽に都合の良い日時をお選びください。',
  ctaButtonLabel: '【1分で完了】ご希望の日時をこちらから選ぶ',
  showBookingNote: false,
  jobSection: {
    heading: '＼ 今ご紹介できるイチオシ求人をチラ見せ ／',
    lead: '以下のような好条件求人をご用意しています。',
    listings: [
      {
        title: '1 2tドライバー・年間休日125日',
        salary: '月給29.2万円〜34.3万円＋インセンティブあり',
        feature: '2tトラックのドライバー職\n年間休日125日でプライベートも充実！',
      },
      {
        title: '2 資格取得支援あり・残業少なめ',
        salary: '月給25万円〜51.3万円',
        feature: '残業月平均10時間・年間休日120日\n資格取得支援ありでキャリアアップも！',
      },
    ],
  },
  closingParagraphs: [
    'ここだけの「リアルな本音」、ちょっと聞いてみませんか？',
    '「一番稼げる会社はどこ？」「労働時間は本当にきつくない？」など、ネットの検索では出てこない業界の裏事情を、10分〜20分の電話（またはオンライン）でこっそりお伝えします。',
    '「まずは情報収集だけしたい」「話を聞いてみたい」という動機で全く問題ありません。\n履歴書も不要ですので、ぜひ上のURLからお気軽にご予約ください。\nご予約をお待ちしています。',
  ],
  phone: '03-6692-0477',
};

// ─── RIDE JOBメカニック (整備士: mechanic + mechanic_newgrad) ─
// ⚠️ TODO: この文面は仮の下書きです。実コピーをご支給いただき次第差し替えてください。
const MECHANIC_CONTENT: MailContent = {
  brandName: 'RIDE JOBメカニック',
  fromName: 'RIDE JOBメカニック',
  subject: '【RIDE JOBメカニック】もう、我慢して働くのはやめませんか？',
  bookingUrl: 'https://leomeet.pmagent.jp/book/mec',
  bodyParagraphs: [
    '「毎日こんなにがんばっているのに、なぜ生活がラクにならないんだろう？」 そう思ったことはありませんか？',
    'それは、あなたが悪いのではありません。「我慢すれば報われる」という会社都合のルールに縛られているからです。',
    '世渡り上手で器用な人たちを、うらやむ必要はありません。\n人間関係のゴマすりや書類作りなんて、稼ぐ力とは関係ないからです。不器用なのは、あなたが真っ直ぐに生きている証拠です。',
    '整備士は、口先だけの人たちに左右されない「手に職」の仕事です。\nわずらわしい人間関係から解放され、磨いてきた技術がそのままあなたの市場価値になります。\n自分の腕一本で、オフィスで威張っている人たち以上に稼げる世界です。',
  ],
  ctaHeading: 'もう、誰かのために自分をすり減らすのは終わりにしませんか？',
  ctaSubheading: 'まずは履歴書なしで、フランクにお話ししましょう。',
  ctaButtonLabel: '新しい一歩を踏み出す（30分カジュアル面談）',
};

// ─── クーパン / ロケットナウ (営業職) ───────────────────
// ⚠️ **文面は未確定。** 運用側(小笠原さん)とクライアント確認を通してから本番投入すること。
//
// 既存3種の流用は不可。すべてドライバー転職訴求（件名例「あなたに合ったドライバーの
// 『好条件求人』を…」）で、営業職に応募した人に送ると文脈が壊れる。
//
// 給与・勤務地・選考フローの具体値は**あえて書いていない**。2026年1〜3月の配信当時の
// 条件（初月64万・月給32万〜等）がいま有効かがクライアント未確認のため
// （設計書「クーパンLP_最新化設計」§7 B1）。確認が取れたら訴求を足す。
const COUPANG_CONTENT: MailContent = {
  brandName: 'RIDE JOB',
  fromName: 'RIDE JOB',
  subject: '【ご応募ありがとうございます】ロケットナウ営業職・面談日程のご案内',
  bookingUrl: 'https://leomeet.pmagent.jp/book/cpj',
  // 「営業職」と断定しない。アカウントマネージャーは過去LPで「営業サポート事務」と
  // 訴求されており、事務職のつもりで応募した人との齟齬が出るため。
  greetingLine:
    'ロケットナウ（CP One Japan 合同会社）の募集職種へご応募いただきありがとうございます。',
  bodyParagraphs: [
    'ご応募を確かに受け付けました。この後、担当者よりお電話またはオンラインで、ご応募いただいた職種の詳細と選考の進め方をご案内します。',
    '募集の背景や実際の働き方、どんな方が活躍されているかは、求人票だけでは伝わりにくい部分です。お話ししながら、ご希望と合うかを一緒に確認させてください。',
  ],
  ctaHeading:
    'ご都合の良い日時を、あらかじめお選びいただけます。',
  ctaSubheading:
    '所要時間は10分〜20分程度です。履歴書のご用意は不要です。\n下のリンクから、ご希望の日時をお選びください。',
  ctaButtonLabel: '【1分で完了】面談の日時を選ぶ',
  phone: '03-6692-0477',
};

const CONTENT_BY_ORIGIN: Record<EmailFormOrigin, MailContent> = {
  default: RIDEJOB_CONTENT,
  bus: RIDEJOB_CONTENT,
  truck: TRUCK_CONTENT,
  mechanic: MECHANIC_CONTENT,
  mechanic_newgrad: MECHANIC_CONTENT,
  coupang: COUPANG_CONTENT,
};

/**
 * 送信時に参照される基本情報 (件名・送信者表示名・URL等)。
 * MailContent から BrandConfig 部分のみを公開する。
 */
export function getBrandConfig(formOrigin: EmailFormOrigin): BrandConfig {
  const c = CONTENT_BY_ORIGIN[formOrigin];
  return {
    brandName: c.brandName,
    fromName: c.fromName,
    subject: c.subject,
    bookingUrl: c.bookingUrl,
  };
}

// ──────────────────────────────────────────
// Design tokens (HTML email-safe)
// ──────────────────────────────────────────
const COLOR_GOLD = '#a18a5c';
const COLOR_TEXT = '#1a1a1a';
const COLOR_TEXT_SUB = '#444444';
const COLOR_LABEL = '#999999';
const COLOR_BORDER = '#e8e3d6';
const COLOR_DASH = '#d4d4d4';
const COLOR_PAGE_BG = '#f7f5f0';
const COLOR_CARD_BG = '#ffffff';
const COLOR_BUTTON_BG = '#1a1a1a';

const FONT_STACK =
  "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic Medium','Yu Gothic',Meiryo,sans-serif";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 文字列内の \n を <br> に変換 (HTMLエスケープ済の前提で呼ぶこと) */
function nl2br(s: string): string {
  return s.replace(/\n/g, '<br>');
}

/** 「LABEL ──── 日本語ラベル」形式のセクション見出しを生成。 */
function sectionLabel(en: string, ja: string): string {
  return `<div style="font-size:11px;letter-spacing:0.18em;font-weight:bold;color:${COLOR_GOLD};margin:0;">${escapeHtml(en)}&nbsp;&nbsp;<span style="color:${COLOR_DASH};font-weight:normal;">────</span>&nbsp;&nbsp;<span style="color:#666666;letter-spacing:0.05em;font-weight:normal;">${escapeHtml(ja)}</span></div>`;
}

/** 段落 HTML を生成 (本文用) */
function paragraph(innerHtml: string, bottomPx: number = 20): string {
  return `<div style="font-size:14px;color:${COLOR_TEXT};line-height:2.0;padding-bottom:${bottomPx}px;">${innerHtml}</div>`;
}

/** 求人 1 件のカード HTML を生成。 */
function jobCard(listing: JobListing): string {
  const title = escapeHtml(listing.title);
  const salary = nl2br(escapeHtml(listing.salary));
  const feature = nl2br(escapeHtml(listing.feature));
  const labelStyle = `display:inline-block;font-size:12px;font-weight:bold;color:${COLOR_GOLD};min-width:3.5em;`;
  const valueStyle = `font-size:13px;color:${COLOR_TEXT_SUB};line-height:1.8;`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;">
            <tr><td style="background:#faf8f3;border:1px solid ${COLOR_BORDER};border-radius:4px;padding:14px 16px;">
              <div style="font-size:14px;font-weight:bold;color:${COLOR_TEXT};line-height:1.6;padding-bottom:8px;">【${title}】</div>
              <div style="padding-bottom:4px;"><span style="${labelStyle}">給与</span><span style="${valueStyle}">${salary}</span></div>
              <div><span style="${labelStyle}">特徴</span><span style="${valueStyle}">${feature}</span></div>
            </td></tr>
          </table>`;
}

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

type TemplateInput = {
  applicantName: string;
  applicantNameKana?: string;
  phoneNumber?: string;
  email: string;
  formOrigin: EmailFormOrigin;
};

export function buildApplicationConfirmationHtml(input: TemplateInput): string {
  const content = CONTENT_BY_ORIGIN[input.formOrigin];
  const safeName = escapeHtml(input.applicantName || 'お客様');
  const safeBrand = escapeHtml(content.brandName);
  const safeSubject = escapeHtml(content.subject);
  const ctaUrl = content.bookingUrl;

  const bodyParagraphsHtml = content.bodyParagraphs
    .map((p, i) => {
      const isLast = i === content.bodyParagraphs.length - 1;
      const html = nl2br(escapeHtml(p));
      return paragraph(html, isLast ? 8 : 20);
    })
    .join('');

  const greetingLine = content.greetingLine
    ? escapeHtml(content.greetingLine)
    : `${safeBrand}へのご登録ありがとうございます。`;

  // 求人紹介セクション (任意)
  const jobSectionHtml = content.jobSection
    ? `<tr><td class="px" style="padding:8px 40px 0 40px;">
          <div style="font-size:15px;font-weight:bold;color:${COLOR_TEXT};text-align:center;line-height:1.8;padding-bottom:6px;">
            ${escapeHtml(content.jobSection.heading)}
          </div>
          ${
            content.jobSection.lead
              ? `<div style="font-size:13px;color:${COLOR_TEXT_SUB};text-align:center;line-height:1.8;padding-bottom:18px;">${escapeHtml(content.jobSection.lead)}</div>`
              : '<div style="height:6px;line-height:6px;font-size:0;">&nbsp;</div>'
          }
          ${content.jobSection.listings.map(jobCard).join('')}
          <div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>
        </td></tr>`
    : '';

  // 締めの段落 (任意)
  const closingHtml =
    content.closingParagraphs && content.closingParagraphs.length > 0
      ? `<tr><td class="px" style="padding:20px 40px 8px 40px;">
          ${content.closingParagraphs
            .map((p, i) => {
              const isLast = i === content.closingParagraphs!.length - 1;
              return paragraph(nl2br(escapeHtml(p)), isLast ? 8 : 20);
            })
            .join('')}
        </td></tr>`
      : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeSubject}</title>
  <style>
    /* モバイル(600px以下)では左右の余白を詰めて本文の表示幅を広げる。
       縦方向のパディングは各セルのインライン指定をそのまま維持する。 */
    @media only screen and (max-width:600px) {
      .px { padding-left:20px !important; padding-right:20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${COLOR_PAGE_BG};font-family:${FONT_STACK};color:${COLOR_TEXT};line-height:1.9;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR_PAGE_BG};">
    <tr><td align="center" style="padding:0;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${COLOR_CARD_BG};border-radius:6px;">
        <tr><td class="px" style="padding:48px 40px 16px 40px;">

          ${sectionLabel('MESSAGE', `${content.brandName}より`)}

          <div style="height:32px;line-height:32px;font-size:0;">&nbsp;</div>

          <div style="font-size:17px;color:${COLOR_TEXT};padding-bottom:24px;">
            ${safeName} 様
          </div>

          ${paragraph(`株式会社PM Agentです。<br>${greetingLine}`, 28)}

          ${bodyParagraphsHtml}

        </td></tr>

        <tr><td class="px" style="padding:24px 40px 0 40px;">
          <div style="border-top:1px solid ${COLOR_BORDER};height:0;line-height:0;font-size:0;">&nbsp;</div>
        </td></tr>

        <tr><td class="px" style="padding:28px 40px 8px 40px;">

          <div style="font-size:15px;color:${COLOR_TEXT};font-weight:bold;line-height:1.8;padding-bottom:8px;">
            ${nl2br(escapeHtml(content.ctaHeading))}
          </div>
          <div style="font-size:14px;color:${COLOR_TEXT_SUB};line-height:1.9;padding-bottom:24px;">
            ${nl2br(escapeHtml(content.ctaSubheading))}
          </div>

          <!-- CTA Button -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
            <tr><td style="background:${COLOR_BUTTON_BG};border-radius:2px;">
              <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;line-height:1;">
                ${escapeHtml(content.ctaButtonLabel)}&nbsp;→
              </a>
            </td></tr>
          </table>

          <div style="font-size:12px;color:${COLOR_LABEL};word-break:break-all;padding:14px 0 24px 0;">
            <a href="${ctaUrl}" style="color:${COLOR_LABEL};text-decoration:underline;">${ctaUrl}</a>
          </div>

          ${
            content.showBookingNote === false
              ? ''
              : `<div style="font-size:11px;color:${COLOR_LABEL};line-height:1.7;padding-bottom:8px;">
            ※すでに面談をご予約済みの方にも行き違いで配信される場合がございます。あらかじめご了承ください。
          </div>`
          }

          <div style="height:24px;line-height:24px;font-size:0;">&nbsp;</div>

        </td></tr>

        ${jobSectionHtml}

        ${closingHtml}

        <tr><td class="px" style="padding:0 40px;">
          <div style="border-top:1px solid ${COLOR_BORDER};height:0;line-height:0;font-size:0;">&nbsp;</div>
        </td></tr>

        <tr><td class="px" style="padding:24px 40px 40px 40px;">
          <div style="font-size:12px;color:#666666;line-height:1.9;">
            株式会社PM Agent<br>
            ${content.phone ? `TEL：${escapeHtml(content.phone)}<br>` : ''}
            <a href="https://pmagent.jp/" style="color:${COLOR_GOLD};text-decoration:underline;">https://pmagent.jp/</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildApplicationConfirmationText(input: TemplateInput): string {
  const content = CONTENT_BY_ORIGIN[input.formOrigin];
  const line = '────────────────────────────';

  const greetingLine =
    content.greetingLine ?? `${content.brandName}へのご登録ありがとうございます。`;

  const lines: string[] = [
    `${input.applicantName || 'お客様'} 様`,
    '',
    '株式会社PM Agentです。',
    greetingLine,
    '',
  ];

  content.bodyParagraphs.forEach((p, i) => {
    lines.push(p);
    if (i < content.bodyParagraphs.length - 1) {
      lines.push('');
    }
  });

  lines.push(
    '',
    content.ctaHeading,
    content.ctaSubheading,
    '',
    `▼${content.ctaButtonLabel}`,
    ` ${content.bookingUrl}`
  );

  if (content.showBookingNote !== false) {
    lines.push(
      '',
      '※すでに面談をご予約済みの方にも行き違いで配信される場合がございます。あらかじめご了承ください。'
    );
  }

  // 求人紹介セクション (任意)
  if (content.jobSection) {
    lines.push('', content.jobSection.heading);
    if (content.jobSection.lead) {
      lines.push(content.jobSection.lead);
    }
    content.jobSection.listings.forEach((job) => {
      lines.push('', `【${job.title}】`, `給与：${job.salary}`, `特徴：${job.feature}`);
    });
  }

  // 締めの段落 (任意)
  if (content.closingParagraphs && content.closingParagraphs.length > 0) {
    content.closingParagraphs.forEach((p) => {
      lines.push('', p);
    });
  }

  lines.push('', line, '', '株式会社PM Agent');
  if (content.phone) {
    lines.push(`TEL：${content.phone}`);
  }
  lines.push('https://pmagent.jp/');

  return lines.join('\n');
}
