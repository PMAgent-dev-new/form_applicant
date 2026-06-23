# ridejob.jp/entry マルチゾーン配信ドキュメント

このリポジトリ（`form_applicant` = 応募フォーム）は、**2つのドメインに同時配信**されています。
本ドキュメントは、その仕組み・運用・注意点をまとめたものです。

- `https://ridejob.pmagent.jp`（従来）
- `https://ridejob.jp/entry`（新規・basePath配下）← 本ドキュメントの主題

---

## 1. 目的

求人サイト `ridejob.jp/job`（別アプリ）と応募フォームを **同一ドメイン（ridejob.jp）** に揃え、
クロスドメインで分断されていた **計測（Cookie / Meta ピクセル等）をつなぐ** のが目的。
そのため、応募フォームを `ridejob.jp/entry` 配下にも複製配信している。

---

## 2. 全体アーキテクチャ

```
                    ┌─────────────────────────────┐
   ユーザー ──────▶ │  Cloudflare Worker「ridejob」 │  ← ridejob.jp への全リクエストを受ける
                    └──────────────┬──────────────┘
                                   │ パスで振り分け（プロキシ）
        ┌──────────────┬───────────┼───────────┬───────────────┐
        ▼              ▼           ▼           ▼               ▼
   /ssw → ssw-main  /media →    /entry →    その他(/ , /job) → 静的アセット
                    newmedia    ridejob-     jobmadley         (Referer判定)
                    (CMS)       entry ★      (求人サイト本体)
                                │
                                ▼
                    Vercel: ridejob-entry
                    (このリポジトリ・basePath=/entry)
```

- **ルーティングは Cloudflare Worker で行っている**（Vercel の rewrites ではない）。ここ重要。
- `ridejob.jp` への全リクエストは Worker を通り、パス接頭辞で各 Vercel プロジェクトへプロキシされる。

---

## 3. Cloudflare Worker「ridejob」

- 場所: Cloudflare Dashboard > Workers & Pages > `ridejob`（account `f77590d69c2ca001a1f68539b413a095`）
- リポジトリには含まれない（Cloudflare 側で管理）。本ドキュメントが唯一の控え。

### ルーティング（要約）

| 順 | パス | 振り分け先 |
|---|---|---|
| 1 | `/ja` | → `/ssw` へ 301 リダイレクト |
| 2 | `/ssw[...]` | `https://ssw-main.vercel.app` |
| 3 | `/media[...]` | `https://newmedia-eight.vercel.app`（CMS） |
| **3.5** | **`/entry[...]`** | **`https://ridejob-entry.vercel.app`（このリポジトリ）** |
| 4 | 静的アセット(`/_next` `/static` `/favicon` `/robots` `/logo` `/sitemap`) | Referer に `/media` を含めば CMS、無ければ jobmadley |
| 5 | その他（`/`, `/job` 等） | `https://jobmadley.vercel.app`（求人サイト本体） |

### /entry ブロック（3.5）

```js
/* --- 3.5 /entry → 応募フォーム (basePath=/entry) ------------- */
if (url.pathname === '/entry' || url.pathname.startsWith('/entry/')) {
  return proxy(request, url, 'https://ridejob-entry.vercel.app');
}
```

- `/media` と違い **Referer ハック（④）は不要**。`/entry` は basePath を採用しているため、
  ページ・`/entry/_next/*`・`/entry/api/*` がすべて `/entry/` 接頭辞に揃い、この1ルールで完結する。
- Worker を編集する際は **本番ドメイン全体に影響**する。デプロイ前に差分を確認し、
  問題時は Cloudflare のバージョン履歴から1クリックでロールバックできる。

---

## 4. Vercel プロジェクト構成

このリポジトリ（`Kei5665/form_applicant`）は **2つの Vercel プロジェクト**に接続されている。
どちらも **本番ブランチ = `main`**。

| プロジェクト | 配信先 | basePath | 備考 |
|---|---|---|---|
| `ridejob-form`（従来） | `ridejob.pmagent.jp` | なし | env 未設定で従来どおり |
| `ridejob-entry`（新規） | `ridejob.jp/entry`（Worker経由） | `/entry` | env `NEXT_PUBLIC_BASE_PATH=/entry` |

### 重要：main にマージすると両方が自動デプロイされる

```
PR を main にマージ
  ├─→ ridejob-form  再ビルド → ridejob.pmagent.jp
  └─→ ridejob-entry 再ビルド → ridejob.jp/entry
```

PR のチェック欄にも `Vercel – ridejob-form` と `Vercel – ridejob-entry` の2つが並ぶ。
**pmagent.jp 用のつもりの変更も自動的に /entry に反映される**ので、basePath を壊さない実装が必須（第5章）。

### 環境変数

- `ridejob-entry` には `ridejob-form` と同じ実行用 env 一式 ＋ `NEXT_PUBLIC_BASE_PATH=/entry` を設定。
- **Deployment Protection はオフ（公開）**。有効だと Worker の fetch が 401 になる。
- env を変更したら **再デプロイ**しないと反映されない（Vercel の env はビルド/デプロイ時に適用）。

---

## 5. basePath 対応で守るルール（重要・最重要）

basePath 配下では **/public のアセットが `${BASE_PATH}/...` でしか配信されない**。
Next.js は次の箇所に basePath を**自動補完しない**ため、明示対応が必要：

- `next/image` の最適化URL（`url=` パラメータ）／ SVG 等の生 src
- 生 `img.src`（プリローダー等）
- CSS の `url(/images/...)`
- kuromoji の `dictPath`
- クライアントの `fetch('/api/...')`（絶対パス）
- 生 `<a href="/...">`

### 実装ルール

| 対象 | やること |
|---|---|
| 画像表示 | **`next/image` ではなく `@/app/components/AppImage`（ラッパー）** を import する。文字列の絶対パス src に自動で basePath を前置する |
| 任意の /public パス | `assetPath('/...')`（`@/lib/basePath`）で前置 |
| API fetch | `apiPath('/api/...')`（`@/lib/basePath`）で前置 |
| `<Link>` / `router` | basePath が自動付与されるので原則そのままでOK |
| 生 `<a href="/...">` | `` `${BASE_PATH}/...` `` |
| CSS背景画像 | `layout.tsx` で CSS変数として basePath 付きで注入し、`globals.css` は `var(--app-bg-*)` を参照 |

> **新しく /public 画像を足すときは、必ず `AppImage`（=next/imageラッパー）か `assetPath()` 経由で参照すること。**
> 生パスで書くと **pmagent.jp は無事でも /entry だけ 404 で壊れる**。

`BASE_PATH` 未設定（pmagent.jp）では `assetPath`/`apiPath` は素通しになるため挙動は不変。

---

## 6. Lark 通知・Base 登録の振り分け（`api/applicants/route.ts`）

フォーム種別（`formOrigin` / referer）と本番判定（`NODE_ENV==='production'`）で webhook を選ぶ。

### トップ（default）/ bus / taxi＝共通(common)分岐・本番

| 用途 | 使う env（フォールバック順） |
|---|---|
| 通知チャンネル | `LARK_WEBHOOK_URL` → `LARK_WEBHOOK_URL_TEST` |
| Base 登録 | `LARK_BASE_WEBHOOK_URL_PROD` → `LARK_BASE_WEBHOOK_URL` → `LARK_BASE_WEBHOOK_URL_TEST` |

- `LARK_SEND_BASE_ONLY=true` のときは **通知をスキップ**し Base 登録のみ実行。
- mechanic / coupang は専用 env（`..._MECHANIC[_PROD]` / `..._COUPANG[_PROD]`）を優先。
- **`LARK_WEBHOOK_URL_TOP_PROD` と `LARK_WEBHOOK_URL_PROD` はコードから参照されていない**（旧式・無視される）。
  トップの通知先を変えたいときは `LARK_WEBHOOK_URL` の値を変更する（default/bus/taxi 共通な点に注意）。

---

## 7. デプロイ・運用の流れ

1. ブランチを切って実装 → PR を `main` へ。
2. PR で `ridejob-form` と `ridejob-entry` 両方のプレビューがビルドされる。
   - basePath 関連は **`ridejob-entry` のプレビュー**でブラウザ確認するのが確実（pmagent では再現しない不具合がある）。
   - プレビューは Vercel 認証保護のため curl 不可。ブラウザ（Vercelログイン）で開く。
3. マージ → 両プロジェクトが本番デプロイ。
4. Worker / env を変えた場合のみ、別途 Cloudflare Worker 編集 or Vercel 再デプロイが必要。

---

## 8. 既知の不具合と原因（トラブルシュート）

### /entry でローディングが終わらない（解消済 / PR #11）
- 原因: `useImagePreloader` の `onComplete` がインライン関数で、親の再レンダーごとに effect が再実行され、
  完了タイマーが毎回 `clearTimeout` されて永久に完了しなかった。**ローカルでは再現せず Vercel配信でのみ顕在化**。
- 対処: `onComplete` を ref 化＋完了1回（doneRef）＋5秒フォールバック固定。

### /entry で画像・背景が出ない / 画像切れ（解消済 / PR #10, #12）
- 原因: 画像アセットが basePath 無しで参照され 404（第5章の漏れ）。
- 対処: `AppImage` ラッパー化、`assetPath()`、CSS変数化、`dictPath` 対応 等。
  - 補足: import が**ダブルクォート**だった完了ページ群が初回の一括置換から漏れた（#12 で対応）。

---

## 9. 残タスク

- [ ] **求人サイト（jobmadley）の応募CTAを `ridejob.pmagent.jp` → `ridejob.jp/entry` に切替**（同一ドメイン計測の本丸・別リポジトリ）。
- [ ] `/entry/coupang` `/entry/mechanic` を本番運用する場合のみ、対応する `_PROD` 系 Lark env を `ridejob-entry` に追加。
