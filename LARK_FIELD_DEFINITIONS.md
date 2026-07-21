# Lark Base フィールド定義

応募APIからLark Baseへ保存する流入・Meta広告関連フィールドの定義。
Larkの「フィールドの説明」とコードの仕様を一致させるための管理用ドキュメント。

| フィールド | 説明 |
| --- | --- |
| 流入媒体（自動判定） | URLのutm_source・utm_mediumなどから自動判定した応募の流入媒体です。例：Meta広告、Googleリスティング、TikTok広告、直接アクセス。広告名や広告画像ではありません。 |
| utm_source | 応募者が流入した媒体を表すURLパラメータの値です。例：meta、facebook、google、tiktok。流入媒体の自動判定やSMS送信時の媒体記録に使用します。 |
| utm_medium | 流入の種類を表すURLパラメータの値です。例：ad、search、organic。utm_sourceと組み合わせて流入媒体を判定します。 |
| utm_campaign | 広告URLのutm_campaignに設定された値をそのまま保存します。キャンペーン名・キャンペーンIDなど、何が入るかは広告側のURL設定によって決まります。キャンペーン別の応募集計に使用します。 |
| utm_term | 広告URLのutm_termに設定された値をそのまま保存します。現在のMeta広告では広告セットID（adset.id）を入れる想定です。広告セット別の応募集計・照合に使用します。 |
| utm_creative | 広告URLのutm_creativeに設定された値をそのまま保存します。過去のURL形式との互換性を維持する目的でも使用しており、数値の場合は広告IDの予備候補として扱います。 |
| utm_content | 広告URLのutm_contentに設定された値をそのまま保存します。現在のMeta広告では広告名（ad.name）を入れる想定です。広告名別の応募確認に使用します。 |
| utm_id | 広告URLから受け取ったMeta広告ID（ad.id）です。Meta APIから広告画像やクリエイティブ情報を取得する際の主要な識別子として使用します。 |
| ad_id | システムが確定したMeta広告IDです。通常はutm_idを使用し、取得できない場合のみ過去形式のutm_content・utm_creativeを確認します。Meta APIへの問い合わせと広告別集計に使用します。 |
| ad_creative_id | ad_idを使ってMeta APIから取得した広告クリエイティブIDです。Meta広告管理画面との照合や、広告と素材の紐付け確認に使用します。 |
| ad_image_url | Meta APIから取得した広告画像または動画サムネイルのURLです。応募につながった広告素材の確認に使用します。Facebook CDNの署名付きURLのため、数日で表示できなくなる場合があります。 |
| LP_URL | 応募フォームが送信されたページのURLです。どのLP・導線から応募されたかの確認や、UTM設定の調査に使用します。 |

## Meta広告の推奨URLパラメータ

```text
utm_source=meta
&utm_medium=ad
&utm_campaign={{campaign.name}}
&utm_term={{adset.id}}
&utm_content={{ad.name}}
&utm_id={{ad.id}}
```

## 広告IDの決定順序

`ad_id`は次の優先順位で決定する。

1. `utm_id`
2. 数値の`utm_content`（過去互換）
3. 数値の`utm_creative`（過去互換）

`utm_term`は広告セットIDのため、`ad_id`の候補には使用しない。

## `クリエイティブ`列からの移行

旧`クリエイティブ`列には広告素材ではなく流入媒体名が保存されていたため、
新規登録先を`流入媒体（自動判定）`に変更する。
旧列は新規応募が新列へ登録されることを本番確認し、既存値を移行した後に削除する。
