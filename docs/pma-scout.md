# PMA担当者向けメールスカウト

RIDE JOBの公開求人からClaudeが候補者の選定条件とメール文を提案し、自社内で既存登録者をグループ化する。PMA担当者が対象者と各グループの文面を一括承認すると、最大300人へ個別配送する。同一人は全担当者を通じて7日間に1通。企業向けログイン・SMS・担当者の承認がない自動配信は含まない。

## 構成

- 画面 `/scout`（entry deploymentでは `/entry/scout`）。Supabase Authで確認済みの個人アカウントかつ `scout_staff.active=true` の担当者のみ利用できる。一般登録・共通パスワードは用意しない。
- 候補者はドライバー・整備士の既存Lark DBを読み取り、一覧は1ページ30レコード。個人情報をlocalStorageへ保存しない。
- Larkの同意日・方法に加え、応募受付台帳の同意原文・版・操作・対象チャネルと現在のメール・電話を照合する。同じ受付IDは同意なしを含む初回記録を正本とする。共有メールや連絡先不一致は要確認。
- メール停止は同じメールを持つ両DBの過去記録と `scout_suppressions` を確認する。新しい応募によって停止を解除しない。
- 公開求人IDを指定してmicroCMSから1件照会する。現在の募集・紹介可否・候補者条件・他担当の対応状況は担当者が確認する。未経験・給与等を自動推定しない。
- 個別文面・グループ最終確認の有効期限は15分。一括承認後は2時間以内に未送信分を配送し、期限の延長はしない。送信先・求人の更新、同意・停止は送信前に再照合。連絡先のDBロックを使い、別担当の同時操作も1件だけ受け付ける。
- メール本文・宛先・送信担当・同意の根拠・Gmail受理結果を専用台帳へ記録。Gmail受理を到達・開封と呼ばない。返信・面談等は担当者が手動記録する。
- 通信失敗・送信後の台帳保存失敗は再送しない。`sending` / `unknown` は間隔経過後もロック。管理者が送信済みメール・台帳を照合するまで解除しない。
- 応募受付メールの既存CC/BCCはスカウトへ流用しない。専用のFrom/Reply-Toを明示する。
- 停止リンクのGETは確認画面のみ。ボタンPOSTまたはGmailのone-click POSTで停止。停止を先に永続化し、Larkの同じメールを持つ記録のメール停止フラグのみ更新・読み戻す。SMSは変更しない。Lark反映失敗は履歴画面に件数を表示し、管理者が反映を確認する。スカウトはその間も送信不可。
- スカウト画面・停止画面は広告タグ/流入記録を除外し、CSP・no-referrer・noindex・no-storeを設定。個人情報を広告会社へ送らない。

## 本番設定

新規SaaSは不要。既存の応募受付用SupabaseとGmail APIを使う。**本PRは本番送信の有効化を行わない。** 利用者・返信先の決定と、画面・テスト結果の確認後に有効化する。Claudeは2026-11-24にSonnet 5.5・月100回・税別10米ドル目安を承認済み。送信元は三木さん承認の `RIDE JOB（株式会社PM Agent） <ridejob@pmagent.jp>` に固定。

| 設定 | 用途 |
|---|---|
| `SCOUT_ENABLED` | 管理API有効化。未設定/falseでは停止 |
| `SCOUT_SEND_ENABLED` | 実送信だけの停止スイッチ。初期false |
| `SCOUT_PUBLIC_URL` | 正式なURLの起点。例 `https://ridejob.jp/entry`。Vercel別名ではログイン/送信を許可しない |
| `SUBMISSION_VAULT_URL` / `SUBMISSION_VAULT_SERVICE_KEY` | 既存応募受付DB。ほかの分析用/求人用DBと取り違えない |
| `SCOUT_SUPABASE_ANON_KEY` | 同じSupabaseの公開用Authキー |
| `SCOUT_TOKEN_SECRET` | ランダム32文字以上。ログに出さずサーバー秘密設定に保存。変更時は既存下書きを作り直す |
| `SCOUT_REPLY_TO` | 返信窓口。未設定では確認文面を作れない。送信元はコードで承認済みアドレスに固定 |
| `SCOUT_SENDER_POSTAL_ADDRESS` | メール署名の事業者住所 |
| `SCOUT_AI_ENABLED` | Claudeによる提案作成の有効化。未設定/falseでは呼ばない |
| `SCOUT_CLAUDE_API_KEY` / `SCOUT_CLAUDE_MODEL` | サーバー秘密設定。モデルを自動選択/変更せず、用意されたClaude APIへ接続 |
| `SCOUT_AI_MONTHLY_LIMIT` | 承認された全担当者合算の月間呼出し上限。1〜100。未設定では呼ばない |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` または `GOOGLE_SERVICE_ACCOUNT_KEY` | 既存Gmail委任。追加スコープを要求しない |
| `APP_ID_RIDEJOB` / `APP_SECRET_RIDEJOB` / `APP_TOKEN_RIDEJOB` と `..._MECHANIC` | 既存Lark接続。本文中の対象Base以外には接続しない |
| `MICROCMS_SERVICE_DOMAIN` / `MICROCMS_API_KEY` | 既存の公開求人読み取り |

1. 対象Supabaseへ `supabase/migrations/202611240001_scout.sql` → `202611240002_scout_groups.sql` の順に適用する（追加テーブル/関数のみ）。既存の `submissions` / `submission_vault` を持つことを先に確認。
2. 承認された担当者だけSupabase Authの確認済みユーザーとして用意し、対応するUUID・メール・氏名を `scout_staff` に登録する。他用途のAuth設定や全体のsignup設定を変更しない。
3. 上の接続を設定し、最初は `SCOUT_SEND_ENABLED=false`。本人のログイン、本人以外の拒否、実際のLark読取り、同意照合、公開求人、署名・返信先を確認する。ユーザーが承認したテスト宛先以外へ送らない。
4. 承認されたテスト1件でGmail受理ID・受信・返信先・停止操作・停止のDB/Lark読み戻し・再送拒否を確認後に運用開始。対象テストと許可は別途記録する。

担当者が毎回操作する機能であり、新しい定時ジョブは作成しない。読取/記録/同意確認が失敗した場合は送信を許可しない。停止時は `SCOUT_SEND_ENABLED=false`。管理画面も閉じる場合は `SCOUT_ENABLED=false`。台帳・停止記録は消さない。保存期間・削除方法は運用開始前にPMAの既存方針と照合する。


## AIによる準備とグループ送信

1. 公開求人IDを指定する。Claudeには許可リストの求人タイトル・公開社名・勤務地・職種・仕事内容・求める人材だけを渡す。候補者、担当者、連絡先、自由入力のプロンプトは渡さない。非公開社名は「非公開」に置き換える。
2. Claudeが登録職種の候補、求人原文にある資格語、件名・本文、確認点を返す。未知の職種、原文にない資格語、年齢等の属性条件、任意URL等は採用しない。モデルの選定理由や求人適合の結論を事実とは扱わない。
3. 登録職種はタクシー・ハイヤー・トラック・バス・整備士・講師・製造/組立を区別する。自社側で登録職種×求人勤務地の都道府県を照合し、資格記載一致あり/要確認に分ける。都道府県一致は通勤可能・希望の確定ではない。職種/居住地不明は自動で広げない。現在の就業・転職意向を登録日から推測しない。同意・停止・直近の送信・結果不明・同一メール/電話の重複を除外。
4. 担当者がグループ/個人を選択し、グループごとの文面を調整。現在募集中・紹介可能、全対象者の条件と他担当の状況を確認してプレビューを作る。この段階では送らない。
5. 宛先・件名・全本文をDBトランザクションで固定する。画面には候補者一覧と選択した1人分の本文だけを返し、同意原本等の内部スナップショットは返さない。300人超のグループは、登録日順に上限までまとめて選択するボタンも用意する（意向や適合度の評価ではない）。担当者が最終確認をチェックして一括承認。配送は1リクエスト1人で進め、全件BCCは使わない。配送中の進捗は変更した1人分だけを返す。各人の直前にLark/同意/求人を再取得し、原本の変更や停止があれば中断する。
6. 画面を開いている間だけ次の1件を処理する。中断/画面を閉じた場合、処理中の1通は送られる可能性があるが次の送信は開始しない。最近のグループから状態を取得し、未送信分のみ再承認して再開できる。結果不明・処理中が残る場合は管理者の照合が必要で、自動再送しない。

生成は `https://api.anthropic.com/v1/messages` に限定し、入力24,000 UTF-8バイト、出力1,800トークンまで。ツールは提案結果を返すだけで外部操作をしない。月間上限は日本時間の暦月・全担当者合算でDBから原子的に確保し、失敗・タイムアウトも1回に数える。自動再試行・モデルのフォールバックなし。モデル/金額はClaude接続準備時に確定し、OpenAI提案時の金額を流用しない。運用開始前に、選んだモデルで日本語の実出力・原文整合・利用量を実測する。

実在者への送信は未実施。ローカルのAI/メール/UIテストは偽の応答のみ。本番のキーはVercelのSecretに保存し、読み戻さずサーバー上で検証する。定時ジョブや新しい外部送信システムは作らない。送信の停止は `SCOUT_SEND_ENABLED=false`、AI呼出しの停止は `SCOUT_AI_ENABLED=false`。

## 検証

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。

SQLの権限・同時実行・結果不明・停止・初回同意の扱いは、専用ローカルPostgresを起動して以下で検証できる。実在者データや本番接続は使わない。

```
SCOUT_TEST_PG_HOST=/tmp/pma-scout-pg-20261124 SCOUT_TEST_PG_PORT=55483 python3 scripts/test-scout-db.py
```

公式仕様参照：
- [Gmail APIによるメール送信](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Supabaseのサーバー認証](https://supabase.com/docs/guides/auth/server-side/nextjs)

- [Claude Messages API・ツール定義](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)

## 担当者未登録時の単発接続確認

`SCOUT_ENABLED`・`SCOUT_AI_ENABLED`・`SCOUT_SEND_ENABLED`をすべてfalseのまま、承認済みの公開求人3件だけを`scout-preflight.ts`で検証できる。通常buildには接続せず、既存ridejob-entryへ`--prod --skip-domain`の単発buildで実行し、既存ドメインの割当を変更しない。結果を保存後、当該検証デプロイだけを削除し、旧本番のaliasが維持されたことを確認してからmainへ進める。検証版を既存の自動ロールバック候補へ残さない。モデルはSonnet 5.5、入力上限・出力上限・公開情報の限定・応答検証を本体と共有する。

先にJST当月の`scout_ai_usage`行を用意し、開始時のattemptsと1時間以内の期限を固定する。実行例：`npx tsx scripts/scout-preflight.ts --approved-three-public-jobs YYYY-MM-01 0 DEADLINE_ISO`。各API呼出しの前にattemptsを比較付き更新し、同じ開始値での再実行や競合は止める。失敗も1回として残し、3回を月間100回に含める。生成直前にも期限/JST月を再確認する。応答検証が失敗した場合も安全な利用量・終了理由・確保済み回数を記録する。結果は公開求人・下書き・利用量だけをログに残す。候補者の読み取り、担当者の仮作成、Gmail送信は行わない。実施結果・残回数は案件の目標設計書で管理する。
