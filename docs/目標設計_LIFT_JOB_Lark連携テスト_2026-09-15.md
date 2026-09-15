# 目標設計: LIFT JOB Lark連携テスト（2026-09-15）

## 対象クライアント

- 株式会社PM Agent
- 対象サービス: LIFT JOB

## 目的

2026-09-15に本番反映したLIFT JOB応募連携について、応募者向けメール・SMSを発生させずに、Lark通知WebhookとAnyCross/Base連携Webhookが修正後の項目を受理することを確認する。あわせて、テストで判明した `ridejob-entry` の本番環境変数欠落を修復し、両サイトで認証付きreadinessを確認する。

## 完了条件

1. ローカル回帰テストが全件成功する。
   - `npm test`
   - `npm run typecheck`
   - `npm run build`
2. `ridejob-entry` と `ridejob-form` へ `x-health-token` を付けた認証付き本番ヘルスチェックを行い、HTTP 200かつ `{"status":"ready"}` を確認する。`status=ok` は未認証のlivenessなので成功に含めない。
3. Lark通知Webhookへ、個人情報とメンションを含まない下記 `【接続テスト】` 通知を1件だけ送り、HTTP 2xxかつJSON本文の `code=0` を確認する。`code` 欠落、非JSON、非0は成功に含めない。
4. Base payload生成の回帰テストで、下記キーと期待値を確認する。
   - `media_name=Meta広告`
   - `application_source=ig(ad)`
   - `utm_source=ig`
   - `utm_medium=cpc`
   - `utm_campaign=120234567890`
   - `utm_term=120234567891`
   - `utm_content=CR-2608-30`
   - `utm_creative=CR-2608-30_SALES_未経験から法人営業`
   - `utm_id=120234567892`
   - `ad_id=120234567892`
   - `ad_creative_id=''`、`ad_image_url=''`（Meta画像解決をモックした回帰テストの期待値）
   - `page_url=https://ridejob.jp/entry/coupang?utm_source=ig&utm_medium=cpc`
   - `landing_path=/entry/coupang`
   - `initial_referrer`、`attribution_source=query`
   - `form_origin=coupang_rocketnow`、`is_coupang=true`
5. AnyCross/Base連携Webhookの本番送信は、シナリオの後続処理、読み戻し、削除手段を確認できた場合だけ、個人情報を含まない `【接続テスト・削除可】` データを1件送る。成功条件はHTTP 2xxかつJSON本文で `code`／`StatusCode` に非0値がないことに加え、Baseの実レコード読み戻しと削除後0件確認までとする。
6. 権限不足で読み戻せない場合は、本番Base Webhookを送らず、ローカルpayload検証と本番設定のreadiness確認までを実測結果として記録する。

## スコープ外

- 本番応募APIへのテスト応募
- 応募者向けメール・SMSの送信
- 実在人物の氏名・電話番号・メールアドレスの使用
- Lark Baseの列構成変更
- AnyCrossシナリオの設定変更

## 戻し方

- 本番コードの機能差分は追加せず、追加した回帰アサーションは当該テスト差分を戻せば元に戻る。
- 本番環境変数は、`ridejob-entry` に既存の正しいLIFT JOB通知／Base URLを設定し、両サイトとGitHub Actionsへ共通のhealth tokenを設定する。変更前の空値は応募POSTを500にする障害構成のため復旧先にしない。デプロイに問題が出た場合は直前の本番デプロイへ一時rollbackし、非空のWebhook設定は保持したまま既知の本番コミットを再デプロイする。
- Baseテストは読み戻し・削除権限が揃うまで送信しない。
- Baseテストを送信した場合は一意な実行IDでレコードを特定し、削除後に同じ実行IDが0件であることを確認する。
- 通知メッセージは `【接続テスト】` と明記し、実応募と区別する。Incoming Webhookでは削除用message_idを得られない可能性があるため、テスト通知1件は残存を許容する。

## 判断ログ

- 2026-09-15 12:55 JST／Astra判断: 本番応募APIはメール・SMS等の外部副作用を伴うため使用しない。Lark通知とAnyCross/Baseの各Webhookを直接検証する。
- 2026-09-15 12:55 JST／Astra判断: テストデータは個人情報を含めず、通知・Baseの双方で接続テストと識別できる名称にする。
- 2026-09-15 12:55 JST／ユーザー指示: 「修正後のテストも進めて」。個人情報を含まないテスト通知1件とテストレコード1件の実行自体は承認済みと扱う。ただしBaseテストは後続副作用・読み戻し・削除の安全条件が揃わないため、承認不足ではなく実行条件未達として保留する。
- 2026-09-15 13:03 JST／Astra判断: 2観点レビューの指摘を一次コードで再確認し、認証付きヘルスチェックの期待値を `ready` へ訂正した。
- 2026-09-15 13:03 JST／Astra判断: AnyCross/Baseの後続処理・読み戻し・削除を確認できない状態では、本番Base Webhook送信を保留し、ローカルpayload検証とreadiness確認まで進める。
- 2026-09-15 13:03 JST／Astra判断: Lark通知はユーザーのテスト実行指示に基づき、メンションなし・個人情報なし・1件のみ送信する。
- 2026-09-15 13:06 JST／Astra判断: `ridejob-entry` の通知URLが空で両環境一致は未達だったが、既存の正しい送信先候補が実在するかを切り分けるため、実値がある `ridejob-form` のURLへ計画済みのテスト通知を1件だけ送った。Webhook応答は成功したが、通知は削除不能かつ実表示未確認という残存リスクを許容した。
- 2026-09-15 13:08 JST／Astra判断: テストで判明した本番環境変数の修復と再デプロイはVercel／GitHub Actionsの実行枠を消費するため、このテスト作業内では実行せず、人間領域の承認事項として報告する。
- 2026-09-15 13:08 JST／Astra判断: レビューで見つかったランタイムURL検証と空／非JSONレスポンス判定の強化は追加実装にあたるため、本タスクでは事実を記録し、勝手に本番変更しない。
- 2026-09-15 13:11 JST／Astra判断: 既存のBase payload回帰テストで未検証だった `ad_id`、`ad_creative_id`、`ad_image_url` のアサーションを追加し、目標の期待値を実際のテストfixtureへ合わせた。
- 2026-09-15 22:29 JST／ユーザー判断: 「全て本番反映して」。提示済みの本番設定修復、両Vercelプロジェクトの再デプロイ、GitHub Actions secret更新、およびテスト記録・追加アサーションのPR／マージを承認。追加の外部リソースは作成しない。

## 保留

- Lark通知先チャットを読み戻す権限がない場合、通知の実表示確認は保留する。
- LIFT JOB Baseを読み戻す権限・appTokenと、AnyCross/Base Automationの参照権限がない場合、本番Base Webhook送信と実レコード確認は保留する。
- `ridejob-form` の実値を `ridejob-entry` の本番通知／Base環境変数へ設定し、両プロジェクトへ共通の `HEALTH_CHECK_TOKEN` を設定する作業は、2026-09-15 22:29 JSTにユーザー承認済み。
- Base本番テストの実行自体はユーザー指示で承認済み。AnyCrossシナリオとBase Automationの参照権限、およびLIFT JOB Baseの読み書き・削除権限がないため実行条件未達。
- 送信済みテスト通知1件は、Incoming Webhookの応答でmessage_idを取得できず、現環境から通知先チャットも読めないため、実表示確認と削除を保留する。

### 本番設定修復の推奨案と承認情報

- 推奨: `ridejob-form` で実測できたLIFT JOB通知／Base URLを `ridejob-entry` のproductionへ設定し、ランダム生成した共通 `HEALTH_CHECK_TOKEN` を両VercelプロジェクトとGitHub Actions secretへ設定する。
- 影響: 新規プロジェクトや継続課金リソースは作らない。設定反映には `ridejob-entry` と `ridejob-form` の本番再デプロイを各1回、合計2回行う。GitHub Actions secretの更新自体はworkflowを起動せず、次回の通常main pushからreadiness検査に使われる。
- 費用: Vercelの既存契約のビルド／実行枠を2デプロイ分消費する。追加金額は契約と残枠に依存し、現権限では確定できない。
- 戻し方: 変更前の空値は応募POSTが500になる障害構成なので復旧先にしない。再デプロイ自体が失敗した場合はサイト表示を直前の本番デプロイへ一時rollbackするが、LIFT JOB通知／Base URLの非空設定は保持する。その後、既知の本番コミット `29fdfac` を同じ非空設定で再デプロイし、両URLの `status=ready` とLIFT JOB通知疎通を再確認する。health tokenだけに問題がある場合は両Vercel環境とGitHub Actions secretを同時に同じ新値へローテーションし、再度readinessを確認する。

## 仮決めした前提

- Webhookの受理成功と、通知先／Baseの実表示確認は別の完了条件として扱う。
- AnyCrossへのテストデータは、本番応募APIが現在送信するフィールド名と同じ構造にする。

## テスト通知本文

```text
【接続テスト】LIFT JOBのLark通知連携を確認しています（実応募ではありません）
実行ID: LIFT-LARK-E2E-20260915
流入経路: Facebook広告（ad）
キャンペーンID: LIFT-LARK-E2E-20260915
広告セットID: TEST-ADSET-20260915
CR-ID: TEST-CR-20260915
広告ID: 000000000000000
広告名: 接続テスト（実応募ではありません）
LP: https://ridejob.jp/entry/coupang
個人情報: なし
```

送信payloadは実装と同じ `{"msg_type":"text","content":{"text":"..."}}` とする。当初は両Vercelプロジェクトの本番 `LARK_WEBHOOK_URL_COUPANG[_PROD]` の一致確認後に送る予定だったが、`ridejob-entry` の実値が空だったため一致条件は未達。実値が入っていた `ridejob-form` の1 URLだけへ送信した。

## 実行モデル

- Astra: Codexメインセッション（計画、判断、外部テスト、検証、git操作）
- Reviewer相当: `codex exec -s read-only` を2本（事実確認／抜け漏れ・影響）
- Luna相当: `codex exec -s read-only`（必要な読取・棚卸しのみ。成果物への書き込みなし）

## 実測結果

実行日時: 2026-09-15 13:04〜13:08 JST

### ローカル回帰

- `npm test`: 10ファイル、183テスト全件成功。
- `npm run typecheck`: 成功。
- `npm run build`: 成功。27ページを生成。microCMS未設定による既知の静的フォールバック警告のみ。
- LIFT JOB関連の対象テスト再実行: 3ファイル、63テスト全件成功。
  - 通知本文の流入経路・キャンペーン・広告セット・CR・広告・LP
  - Base payloadの `media_name`、`application_source`、UTM v3、`ad_id`、`ad_creative_id`、`ad_image_url`、`page_url`、`landing_path`、`initial_referrer`、`attribution_source`、`form_origin`、`is_coupang`
  - query／click_id／Cookie／referrer／directのアトリビューション
  - 認証付きヘルスチェックの `ready`／`degraded` 判定

### Lark通知Webhook

- `ridejob-form` の本番LIFT JOB通知URLについて、HTTPS、ホスト `open.larksuite.com`、パス `/open-apis/bot/v2/hook/` を満たすことを確認。
- 計画書記載の `【接続テスト】` 通知を、メンション・個人情報なしで1件送信。
- 応答: HTTP 200、JSON、`code=0`、`msg=success`、`StatusCode=0`、`StatusMessage=success`。
- `ridejob-entry` は通知URL実値が空だったため、同プロジェクト経由の通知は未送信・未検証。
- 通知先チャットの読み取り権限がないため、実表示の読み戻しは未確認。

### 本番環境変数とヘルスチェック

- `ridejob-entry`: LIFT JOB通知URL、Base URL、`HEALTH_CHECK_TOKEN` は変数名のみ存在し、productionの実値は空。
- `ridejob-form`: LIFT JOB通知URLとBase URLは実値あり。`HEALTH_CHECK_TOKEN` は空。
- 無認証livenessは両方ともHTTP 200、`{"status":"ok"}`。
- 認証付きreadinessの `{"status":"ready"}` は、両環境にトークン実値がないため確認不能。完了条件2は未達。
- `ridejob-entry` は実配信URLに必要な通知・Base値が空のため、このままではLIFT JOBの本番応募POSTが通知前の必須設定検査で500になる構成。

### AnyCross／Base

- ローカルpayload生成テストは成功。
- AnyCrossシナリオの後続処理、LIFT JOB Baseの読み戻し、テストレコード削除手段を確認できないため、本番Base Webhookへのテスト送信は実施していない。
- 完了条件5は保留。テストレコードは作成していない。

### レビューで見つかった追加課題

- 本番コードはWebhook URLのホスト／パスをランタイムで拒否せず、現行テストは送信先を観測するガードに留まる。
- 通知／Base送信処理は、HTTP 200の空本文・非JSON・成功コード欠落を成功扱いし得る。今回の実通知レスポンスは明示的な成功コードを返したため、接続テストの判定自体は成功。

### 秘密情報の後処理

- Vercel production envの確認に使った一時ディレクトリ2件は削除し、削除後に存在しないことを確認した。
- Webhook URLの実値はコマンド出力・目標設計書・git差分へ表示していない。
- git差分に実値形式のLark Bot／AnyCrossトークンがないことを正規表現検索し、0件を確認した。

### クライアント混入チェック

- 作業対象2ファイル（tracked差分1ファイル、新規未追跡1ファイル）を `leak_check.sh` で検査した。4件検出されたが、すべて自案件の `ridejob-entry`、`ridejob-form`、`ridejob.jp` であり、他クライアント情報ではないことを1件ずつ確認した。
- 画像・動画の変更はない。
