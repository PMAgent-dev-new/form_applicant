# PMA担当者向けメールスカウト

RIDE JOBの既存登録者をPMA担当者が検索し、公開求人を選び、最終文面を確認して1通ずつ送信する。企業向けログイン・SMS・一括自動送信は含まない。

## 構成

- 画面 `/scout`（entry deploymentでは `/entry/scout`）。Supabase Authで確認済みの個人アカウントかつ `scout_staff.active=true` の担当者のみ利用できる。一般登録・共通パスワードは用意しない。
- 候補者はドライバー・整備士の既存Lark DBを読み取り、一覧は1ページ30レコード。個人情報をlocalStorageへ保存しない。
- Larkの同意日・方法に加え、応募受付台帳の同意原文・版・操作・対象チャネルと現在のメール・電話を照合する。同じ受付IDは同意なしを含む初回記録を正本とする。共有メールや連絡先不一致は要確認。
- メール停止は同じメールを持つ両DBの過去記録と `scout_suppressions` を確認する。新しい応募によって停止を解除しない。
- 公開求人IDを指定してmicroCMSから1件照会する。現在の募集・紹介可否・候補者条件・他担当の対応状況は担当者が確認する。未経験・給与等を自動推定しない。
- 文面確認の有効期限は15分。送信先・求人の更新、同意・停止は送信前に再照合。連絡先のDBロックを使い、別担当の同時操作も1件だけ受け付ける。
- メール本文・宛先・送信担当・同意の根拠・Gmail受理結果を専用台帳へ記録。Gmail受理を到達・開封と呼ばない。返信・面談等は担当者が手動記録する。
- 通信失敗・送信後の台帳保存失敗は再送しない。`sending` / `unknown` は間隔経過後もロック。管理者が送信済みメール・台帳を照合するまで解除しない。
- 応募受付メールの既存CC/BCCはスカウトへ流用しない。専用のFrom/Reply-Toを明示する。
- 停止リンクのGETは確認画面のみ。ボタンPOSTまたはGmailのone-click POSTで停止。停止を先に永続化し、Larkの同じメールを持つ記録のメール停止フラグのみ更新・読み戻す。SMSは変更しない。Lark反映失敗は履歴画面に件数を表示し、管理者が反映を確認する。スカウトはその間も送信不可。
- スカウト画面・停止画面は広告タグ/流入記録を除外し、CSP・no-referrer・noindex・no-storeを設定。個人情報を広告会社へ送らない。

## 本番設定

新規SaaSは不要。既存の応募受付用SupabaseとGmail APIを使う。**本PRは本番送信の有効化を行わない。** 利用者・送信元・返信先・間隔の決定と、画面・テスト結果の確認後に有効化する。

| 設定 | 用途 |
|---|---|
| `SCOUT_ENABLED` | 管理API有効化。未設定/falseでは停止 |
| `SCOUT_SEND_ENABLED` | 実送信だけの停止スイッチ。初期false |
| `SCOUT_PUBLIC_URL` | 正式なURLの起点。例 `https://ridejob.jp/entry`。Vercel別名ではログイン/送信を許可しない |
| `SUBMISSION_VAULT_URL` / `SUBMISSION_VAULT_SERVICE_KEY` | 既存応募受付DB。ほかの分析用/求人用DBと取り違えない |
| `SCOUT_SUPABASE_ANON_KEY` | 同じSupabaseの公開用Authキー |
| `SCOUT_TOKEN_SECRET` | ランダム32文字以上。ログに出さずサーバー秘密設定に保存。変更時は既存下書きを作り直す |
| `SCOUT_FROM_EMAIL` / `SCOUT_REPLY_TO` | 許可された送信元と返信窓口。未設定では確認文面を作れない |
| `SCOUT_SENDER_POSTAL_ADDRESS` | メール署名の事業者住所 |
| `SCOUT_COOLDOWN_HOURS` | 承認された担当者横断の送信間隔。未設定では送信不可 |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` または `GOOGLE_SERVICE_ACCOUNT_KEY` | 既存Gmail委任。追加スコープを要求しない |
| `APP_ID_RIDEJOB` / `APP_SECRET_RIDEJOB` / `APP_TOKEN_RIDEJOB` と `..._MECHANIC` | 既存Lark接続。本文中の対象Base以外には接続しない |
| `MICROCMS_SERVICE_DOMAIN` / `MICROCMS_API_KEY` | 既存の公開求人読み取り |

1. 対象Supabaseへ `supabase/migrations/202611240001_scout.sql` を適用する（追加テーブル/関数のみ）。既存の `submissions` / `submission_vault` を持つことを先に確認。
2. 承認された担当者だけSupabase Authの確認済みユーザーとして用意し、対応するUUID・メール・氏名を `scout_staff` に登録する。他用途のAuth設定や全体のsignup設定を変更しない。
3. 上の接続を設定し、最初は `SCOUT_SEND_ENABLED=false`。本人のログイン、本人以外の拒否、実際のLark読取り、同意照合、公開求人、署名・返信先を確認する。ユーザーが承認したテスト宛先以外へ送らない。
4. 承認されたテスト1件でGmail受理ID・受信・返信先・停止操作・停止のDB/Lark読み戻し・再送拒否を確認後に運用開始。対象テストと許可は別途記録する。

担当者が毎回操作する機能であり、新しい定時ジョブは作成しない。読取/記録/同意確認が失敗した場合は送信を許可しない。停止時は `SCOUT_SEND_ENABLED=false`。管理画面も閉じる場合は `SCOUT_ENABLED=false`。台帳・停止記録は消さない。保存期間・削除方法は運用開始前にPMAの既存方針と照合する。

## 検証

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。

SQLの権限・同時実行・結果不明・停止・初回同意の扱いは、専用ローカルPostgresを起動して以下で検証できる。実在者データや本番接続は使わない。

```
SCOUT_TEST_PG_HOST=/tmp/pma-scout-pg-20261124 SCOUT_TEST_PG_PORT=55483 python3 scripts/test-scout-db.py
```

公式仕様参照：
- [Gmail APIによるメール送信](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Supabaseのサーバー認証](https://supabase.com/docs/guides/auth/server-side/nextjs)
