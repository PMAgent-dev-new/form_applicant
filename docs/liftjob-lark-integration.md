# LIFT JOB 応募の Lark 通知・Base 連携

LIFT JOB（ロケットナウ営業職）の応募は
`/api/coupang/applicants` から、専用の Lark Bot Webhook と Base Webhook へ送信する。

通常モードでは通知・Baseの両Webhookを必須とし、どちらかが未設定または許可形式外なら
応募者情報を外部送信する前にHTTP 500で停止する。通知先はLark Bot Incoming Webhook、
Base保存先はAnyCrossまたはLark Base Automation WebhookのHTTPS URLだけを許可する。
AnyCrossは `/anycross/trigger/{id}` と現行の `/anycross/trigger/callback/{id}` の
両形式に対応する。Base送信を最初に行い、失敗した場合は後続の通知・メール・SMS・CAPIを
開始せず、応募APIもHTTP 500を返す。これにより保存漏れを成功扱いせず、再送時の副作用重複を抑える。
通知だけが失敗した場合は、保存済みBaseレコードをブラウザ再送で重複させないため、
失敗をログへ残したうえで応募APIは成功扱いとする。

Webhookの `code=0` はオートメーションによる受理までを示す。Baseレコード作成完了の保証には、
Base側の実レコード監視または永続キューが別途必要である。現環境にはLIFT JOB Baseの
読み戻し権限がないため、本番疎通では受理とpayload生成までを検証対象とする。

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

## Base Webhook の受信キー

AnyCross / Lark Base 側のオートメーションでは、次の対応で必ずマッピングする。

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

`page_url` は Base 側の `LP_URL` へマッピングする。

## 本番反映前後の検証

1. Vercel の認証付き `/api/health` が `ready` を返すこと。
2. UTM v3 一式を入れたテスト応募を1件送ること。
3. Lark 通知で配置・キャンペーンID・CR-ID・広告ID・LPを読み戻すこと。
4. Base で上表の値を読み戻し、Webhook payload と一致すること。
5. テストレコードを削除し、通知チャットにテストであることを残すこと。

Webhook が HTTP 200 を返しても、Lark の `code=0` または `StatusCode=0` が
JSON本文に明示されなければ送信失敗としてログに残す。空本文・非JSON・成功コード欠落も
成功扱いしない。この判定は通常モードとBase-onlyモードの双方に適用する。
