# LIFT JOB 応募の Lark 通知・Base 連携

LIFT JOB（ロケットナウ営業職）の応募は
`/api/coupang/applicants` から、専用の Lark Bot Webhookへ通知し、LIFT JOB Baseへ直接保存する。

通常モードではLark通知とBase保存を必須とする。Baseは専用アプリ資格情報によるBitable APIへの
直接upsertを正本とし、直接接続が未設定の旧環境だけAnyCross / Base Automation Webhookへ
フォールバックする。`submission_id` を検索キー、同じ値から作るLark `client_token` を作成時の
冪等キーにするため、ブラウザ再送・同時送信でも同じ応募レコードへ収束する。Base保存を最初に行い、失敗した場合は後続の通知・メール・SMS・CAPIを
開始せずHTTP 500を返す。通知成功後はBaseの `Lark通知送信済み` を更新し、後続処理の失敗で
再送されても通知を重複させない。通知自体が失敗した場合もHTTP 500を返し、同じ
`submission_id` で安全に再送できる。

旧Webhook経路の `code=0` はオートメーションによる受理までを示す。直接接続ではBitable APIの
record IDを受け取り、`submission_id` で検索して実レコードを読み戻す。LIFT JOB専用アプリの
読み書き・削除権限は2026-09-16に本番Baseで確認済み。

Lark通知へ埋め込む入力値は改行・制御文字を空白へ正規化し、`<` / `>` を全角化する。
応募者入力による通知行の偽装や `<at ...>` メンション記法の成立を防ぐ。

## 流入経路の決定

応募時の UTM は、共通フォームと同じく次の順で決める。

1. 応募時の URL query
2. 着地時に `rj_attr` Cookie へ保存した last touch / first touch
3. `document.referrer`
4. いずれも無い場合は `経路不明`

複数の出所の値は混ぜない。例えば Cookie の `utm_source` と、
別の着地 URL の `utm_content` を同じ応募に書き込まない。

LIFT JOBに限り、応募時queryに `oppref` がありUTMがない場合は
`utm_source=openai` / `utm_medium=cpc` として復元する。過去Cookieに残った `oppref` だけでは
新しい自然流入をChatGPT広告へ上書きしない。`oppref` はBaseへ複製せず、OpenAI
Conversions APIへの成果返却だけに使う。

`rj_attr` は ridejob.jp 本体と共有する互換スキーマのため、Cookie へ保存するのは
`source / medium / campaign / term / content`。LIFT JOBは同一ページで応募まで完結し、
`utm_creative / utm_id` は応募時URLのqueryから取得する。応募時URL自体も
`page_url` に保存するため、Base側で生の着地URLと各分解値を突合できる。

## Lark 通知に出す項目

- LIFT JOB（ロケットナウ）の応募であること
- 流入経路（Facebook / Instagram / Threads / Messenger を識別）
- キャンペーンID（`utm_campaign`）
- 広告セットID（`utm_term`）
- CR-ID（`utm_content`）
- 広告ID（`utm_id`）
- 広告名（`utm_creative`）
- 応募LP URL
- 応募者の入力内容

UTM が取得できない場合は、実際に確認できない媒体名を推測で埋めず
`経路不明（UTM未取得）` と表示する。

## Base の保存項目

直接接続では次の対応で保存する。旧Webhookフォールバックも同じキーのpayloadを送る。

| Base での用途 | Webhook キー | 内容 |
| --- | --- | --- |
| 流入媒体 | `media_name` | Meta広告。UTM欠落時は経路不明 |
| 応募経由 | `application_source` | `fb(ad)` / `ig(ad)` / `th(ad)` など |
| 媒体・配置 | `utm_source` | `fb` / `ig` / `threads` / `msg` など |
| 広告/自然流入区分 | `utm_medium` | LIFT JOB Meta広告は `cpc` |
| キャンペーンID | `utm_campaign` | Meta `campaign.id` |
| 広告セットID | `utm_term` | Meta `adset.id` |
| CR-ID | `utm_content` | `CR-YYMM-NN` |
| 広告名 | `utm_creative` | Meta `ad.name` |
| 広告ID | `utm_id` / `ad_id` | Meta `ad.id` |
| クリエイティブID | `ad_creative_id` | Meta `creative.id` |
| 広告画像 | `ad_image_url` | Meta APIで解決した画像URL |
| 応募LP | `page_url` | 応募確定時のフルURL |
| 初回着地ページ | `landing_path` | サイト内回遊前のパス |
| 初回参照元 | `initial_referrer` | 着地時の referrer |
| UTMの復元元 | `attribution_source` | `query` / `click_id` / `cookie` / `referrer` / `direct` |
| フォーム識別 | `form_origin` | `coupang_rocketnow` |
| 再送時の一意キー | `submission_id` | ブラウザ生成のUUID |
| 通知重複防止 | `Lark通知送信済み` | Lark Bot受理後にtrue |

`page_url` からは `oppref` を除去して保存する。クリック識別子の生値はOpenAI CAPI以外へ複製しない。

## 本番反映前後の検証

1. Vercel の認証付き `/api/health` が `ready` を返すこと。
2. `x-e2e-token` で認証した `testMode` を使い、Meta / ChatGPTテスト応募を各1件送ること。
3. `testMode` ではメール・SMS・Meta CAPIを抑止し、OpenAI CAPIは
   `validate_only=true` にして本番コンバージョンへ計上しないこと。
4. Lark 通知で配置・キャンペーンID・CR-ID・広告ID・LPを読み戻すこと。
5. Baseで上表の値と `Lark通知送信済み=true` を読み戻すこと。
6. 作成時のrecord IDを保持してテストレコードだけを削除し、同じ`submission_id`が0件になったことを確認すること。

Webhook が HTTP 200 を返しても、Lark の `code=0` または `StatusCode=0` が
JSON本文に明示されなければ送信失敗としてログに残す。空本文・非JSON・成功コード欠落も
成功扱いしない。この判定は通常モードとBase-onlyモードの双方に適用する。
