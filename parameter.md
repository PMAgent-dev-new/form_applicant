| 媒体            | 入稿URL                                                                                                           | パラメーター                                                                              |
|:--------------|:----------------------------------------------------------------------------------------------------------------|:------------------------------------------------------------------------------------|
| Googleリスティング  | https://ridejob.pmagent.jp/?utm_source=google&utm_medium=searchh&utm_campaign=em&utm_term={keyword}_{matchtype} | ?utm_source=google&utm_medium=search&utm_campaign=em&utm_term={keyword}_{matchtype} |
| TikTok広告      | https://ridejob.pmagent.jp/?utm_source=tiktok&utm_medium=ad                                                     | ?utm_source=tiktok&utm_medium=ad                                                    |
| TikTokオーガニック  | https://ridejob.pmagent.jp/?utm_source=tiktok&utm_medium=organic                                                | ?utm_source=tiktok&utm_medium=organic                                               |
| meta広告        | https://ridejob.pmagent.jp/?utm_source=tiktok&utm_medium=organic                                                | ?utm_source=meta&utm_medium=ad                                                      |
| YouTubeオーガニック | https://ridejob.pmagent.jp/?utm_source=youtube&utm_medium=organic                                               | ?utm_source=youtube&utm_medium=organic                                              |
| スレッドオーガニック    | https://ridejob.pmagent.jp/?utm_source=threads&utm_medium=organic                                               | ?utm_source=threads&utm_medium=organic                                              |
| ChatGPT広告      | https://ridejob.jp/entry?utm_source=openai&utm_medium=cpc&utm_campaign=taxi&utm_content=CGA-01                  | ?utm_source=openai&utm_medium=cpc&utm_campaign=<職種>&utm_content=<CR-ID>            |

### ChatGPT広告（ChatGPT Ads）の入稿規約

`getMediaName` は openai の medium を `ad / cpc / ads / paid` のいずれでも広告とみなすが、
**入稿は `utm_medium=cpc` に固定する**。理由は2つ。

1. ridejob.jp 本体（jobmadley）のチャネル分類は `cpc / ppc / paid / sem` を有料語彙としており、
   `ad` で入稿すると本体経由の応募だけ「その他」に落ちて集計が割れる。両リポで安全に通るのは `cpc`。
2. 全角（`ｃｐｃ`）は吸収できない。手入力せずこの表からコピーすること。

**`utm_content` に入れる CR-ID は英数字の接頭辞付きにする**（例 `CGA-01`）。
数字のみ5桁以上だと Meta の ad.id と誤認され、`ad_id` 列にコピーされて汚れる
（判定: `src/lib/meta/resolveAdImage.ts`）。

`oppref`（OpenAIのクリック識別子）は着地URLに自動付与されるため手で足さない。
現状 Pixel / Conversions API は未導入で、OpenAI管理画面のコンバージョンは0のまま。
**成果はLark側（応募→面談）で読む**という前提で運用する。

