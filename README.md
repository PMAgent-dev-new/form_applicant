# RIDE JOB 応募フォーム

タクシー運転手の転職支援サービス「ライドジョブ」の応募フォームアプリケーションです。

## 概要

未経験者向けタクシー運転手転職支援サービスの3ステップ応募フォームです。モバイルファーストのレスポンシブデザインで、直感的な操作でスムーズな応募が可能です。

## 主な機能

### 3ステップ応募フォーム
- **STEP1**: 生まれ年（西暦4桁）の入力
- **STEP2**: 氏名（漢字・ひらがな）の入力
- **STEP3**: 郵便番号・携帯番号の入力

### バリデーション機能
- リアルタイム入力検証
- 携帯番号の詳細チェック
  - 070/080/090から始まる11桁の検証
  - 連続する同じ数字（5桁以上）の検出
  - 順序数字パターンの検出
  - 既知の無効番号パターンの検出

### 外部連携
- Lark Webhookへの自動通知
- Google Tag Manager統合（GTM-5CQGTMXF）

### UI/UX
- ローディング画面
- カードベースのステップナビゲーション
- レスポンシブデザイン
- エラーメッセージの表示

## 技術スタック

- **フレームワーク**: Next.js 16.0.8
- **言語**: TypeScript
- **UI**: React 19
- **スタイリング**: Tailwind CSS v4
- **開発環境**: Turbopack
- **コード品質**: ESLint

## セットアップ

### 必要な環境
- Node.js 20以上
- npm

### インストール
```bash
npm install
```

### 環境変数設定
`.env.local`ファイルを作成し、以下を設定：

#### 基本設定（RIDEJOB フォーム用）
```bash
LARK_WEBHOOK_URL=your_lark_webhook_url_here
```

#### Meta計測（直ピクセル + Conversions API）
```bash
NEXT_PUBLIC_META_PIXEL_ID=1945615652686189    # 統合ピクセル「タクシー」（公開値・ページに埋め込まれる）
META_CAPI_ACCESS_TOKEN=your_capi_access_token # Events Manager > 設定で発行・サーバー専用・秘匿。未設定だとCAPIはスキップ
META_TEST_EVENT_CODE=                          # 検証時のみ設定（Events Manager > テストイベント）。本番は空
```

#### Coupangフォーム用設定
```bash
# Lark Webhook URLs（開発環境）
LARK_WEBHOOK_URL_COUPANG_TEST=your_test_webhook_url
LARK_BASE_WEBHOOK_URL_COUPANG_TEST=your_test_base_webhook_url

# Lark Webhook URLs（本番環境）
LARK_WEBHOOK_URL_COUPANG_PROD=your_prod_webhook_url
LARK_BASE_WEBHOOK_URL_COUPANG_PROD=your_prod_base_webhook_url

# Gmail送信用GAS API URL
GAS_EMAIL_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec

# Coupangステップ1選択肢取得用GAS API URL
GAS_COUPANG_STEP1_OPTIONS_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec

# テストモード（オプション、trueの場合Baseのみ送信）
LARK_SEND_BASE_ONLY=false
```

**注意**:
- `GAS_EMAIL_API_URL`の設定方法は`gas/README.md`を参照してください
- Gmail送信機能が不要な場合は`GAS_EMAIL_API_URL`を設定しなくても動作します
- `GAS_COUPANG_STEP1_OPTIONS_API_URL`が未設定または取得失敗時は、Coupangの固定選択肢を使用します

#### 応募受付メール送信（Gmail API / Service Account + DWD）
ライドジョブ・ライドジョブメカニックの応募完了時に応募者へ自動返信メールを送る機能の設定です。
Workspace側で「Service AccountにDomain-Wide Delegationでスコープ `https://www.googleapis.com/auth/gmail.send` を許可」しておく必要があります。

```bash
# 送信元アドレス (impersonate対象)。例: support_team@pmagent.jp
GMAIL_SENDER_EMAIL=support_team@pmagent.jp

# Service Account の JSON 鍵を base64 化したもの (1行に詰める)
# 取得方法: base64 -w0 service-account.json
GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIs...

# (任意) 送信者表示名のオーバーライド。未指定ならフォーム種別ごとの既定値を使用
# GMAIL_SENDER_NAME_OVERRIDE=ライドジョブ運営事務局

# (任意) BCC 宛先 (カンマ区切り)。応募者からは見えず、チーム側だけ受信箱に届く
# GMAIL_BCC=support_team@pmagent.jp,ridejob@pmagent.jp

# (任意) CC 宛先 (カンマ区切り)。応募者からも見える形でCC
# GMAIL_CC=ops@example.com

# (任意) true なら実送信せずログのみ出力。ローカル開発・本番テスト用
# EMAIL_DRY_RUN=true

# (任意) false なら全フォームのメール送信を無効化（緊急停止用）
# ENABLE_EMAIL_NOTIFICATION=true
```

**Workspace側の必須設定**:
1. GCP プロジェクトで Gmail API を有効化 → サービスアカウント作成 → JSON鍵を発行
2. Workspace 管理コンソール → セキュリティ → アクセスとデータ管理 → API 制御 → 「ドメイン全体の委任を管理」
3. サービスアカウントの `client_id`(数字) と スコープ `https://www.googleapis.com/auth/gmail.send` を登録
4. `GMAIL_SENDER_EMAIL` で指定するアドレスが当該Workspaceに存在すること

**対象フォーム**:
- `default`(RIDE JOB) / `bus` → 件名「【ライドジョブ】ご応募ありがとうございます」
- `mechanic` / `mechanic_newgrad` → 件名「【ライドジョブメカニック】ご応募ありがとうございます」
- `coupang` は別ルート/別仕様のため対象外

### 開発サーバー起動
```bash
npm run dev
```
http://localhost:3000 でアクセス可能

### ビルド
```bash
npm run build
```

### 本番環境起動
```bash
npm start
```

## ファイル構成

```
src/
├── app/
│   ├── api/
│   │   └── applicants/
│   │       └── route.ts          # フォーム送信API
│   ├── applicants/
│   │   └── new/
│   │       └── page.tsx          # 申込完了画面
│   ├── favicon.ico
│   ├── globals.css               # グローバルスタイル
│   ├── layout.tsx                # ルートレイアウト（GTM設定含む）
│   └── page.tsx                  # メインフォーム画面
```

## API エンドポイント

### POST /api/applicants
申込フォームデータをLark Webhookに送信

**リクエストボディ:**
```json
{
  "birthDate": "19900101",
  "fullName": "田中 太郎",
  "fullNameKana": "たなか たろう",
  "postalCode": "1234567",
  "phoneNumber": "09012345678"
}
```

**レスポンス:**
```json
{
  "message": "Application submitted successfully!"
}
```

## 開発コマンド

```bash
# 開発サーバー起動（Turbopack使用）
npm run dev

# 本番ビルド
npm run build

# 本番サーバー起動
npm start

# Linting
npm run lint
```

## テスト手順

- 応募API（/api/applicants）のローカルテスト方法は、`TESTING_APPLICANTS_API.md` にまとめています。
  - ローカルWebhookの起動
  - 本番モードでのAPI疎通
  - 送信スクリプトによる複数ケースの一括送信


## セキュリティ機能

- 入力値の厳密なバリデーション
- 不正な携帯番号パターンの検出・通知
- XSS対策（Next.jsの標準機能）
- CSRF対策（Next.jsの標準機能）

## パフォーマンス

- Next.js App Routerによる最適化
- Turbopackによる高速開発環境
- 画像最適化（Next.js Image）
- Code Splitting自動適用

## ブラウザサポート

- Chrome（最新版）
- Firefox（最新版）
- Safari（最新版）
- Edge（最新版）

## ライセンス

© 2025 株式会社PMAgent

## 連絡先

- 運営会社: [株式会社PMAgent](https://pmagent.jp/)
- プライバシーポリシー: [Privacy Policy](https://saiyocommon.com/pmagent/privacy-policy)
