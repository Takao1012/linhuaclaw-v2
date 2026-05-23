---
name: ku-catchup
description: Kindle Unlimited対象の百合漫画をAmazonからリアルタイムで取得し、CraftのKUキャッチアップフォルダにドキュメントとして保存する。「KUキャッチアップ」「KU対象を調べて」「kindle unlimited 百合」などのフレーズが含まれる場合に使用。クエリは引数で受け取る（例：「KUキャッチアップ: 百合漫画, 百合マンガ, 百合 コミック」）。
---

# KU 百合漫画キャッチアップ Skill

## 概要

Kindle Unlimited対象の百合漫画タイトルをAmazonの検索結果ページからリアルタイムで取得し、Craftの専用フォルダにドキュメントとして保存する。

週次キャッチアップ実行時に合わせて動かす想定。クエリはユーザーが指定する。

## 使用MCP

- **Tavily MCP**: `tavily_extract`（Amazon検索結果ページの取得）
- **Craft MCP**: `craft_write` documents create → blocks add（ドキュメント作成と内容保存）

## Step 1: クエリの確認

ユーザーの指示からキーワードリストを取得する。

- 「KUキャッチアップ: 百合漫画, 百合マンガ, 百合 コミック」→ `["百合漫画", "百合マンガ", "百合 コミック"]`
- クエリ指定がない場合はデフォルトを使用する

**デフォルトクエリ（4つ）:**
1. 百合漫画
2. 百合マンガ
3. 百合
4. 百合 コミック

## Step 2: Amazon KU検索URLの組み立て

各キーワードを以下のURLパターンに当てはめる。キーワードはURLエンコードする。

```
https://www.amazon.co.jp/s?rh=n%3A2250738051%2Ck%3A{URLエンコードしたキーワード}%2Cp_n_feature_nineteen_browse-bin%3A3169286051
```

**よく使うクエリのURL（そのまま使用可）:**
- `百合漫画` → `https://www.amazon.co.jp/s?rh=n%3A2250738051%2Ck%3A%E7%99%BE%E5%90%88%E6%BC%AB%E7%94%BB%2Cp_n_feature_nineteen_browse-bin%3A3169286051`
- `百合マンガ` → `https://www.amazon.co.jp/s?rh=n%3A2250738051%2Ck%3A%E7%99%BE%E5%90%88%E3%83%9E%E3%83%B3%E3%82%AC%2Cp_n_feature_nineteen_browse-bin%3A3169286051`
- `百合` → `https://www.amazon.co.jp/s?rh=n%3A2250738051%2Ck%3A%E7%99%BE%E5%90%88%2Cp_n_feature_nineteen_browse-bin%3A3169286051`
- `百合 コミック` → `https://www.amazon.co.jp/s?rh=n%3A2250738051%2Ck%3A%E7%99%BE%E5%90%88+%E3%82%B3%E3%83%9F%E3%83%83%E3%82%AF%2Cp_n_feature_nineteen_browse-bin%3A3169286051`

上記以外のキーワードはその場でURLエンコードして組み立てる。

## Step 3: Tavilyでページを取得

**重要:**
- `tavily_extract` のみを使用すること
- Firecrawlは使用禁止
- Tavilyで取得できた内容をそのまま使うこと。「動的コンテンツが取得できなかった」と判断しないこと
- 取得できなかった場合もFirecrawlに切り替えず、取得できた分だけで処理を続けること

全URLを `tavily_extract`（extract_depth: advanced）で一括取得する。

```
urls: [url1, url2, ...]
query: "百合漫画 kindle unlimited 対象タイトル"
extract_depth: "advanced"
```

## Step 4: タイトル情報の抽出と重複除去

各ページのraw_contentから以下を抽出する：

- **タイトル**（`## タイトル名` のブロック見出し）
- **著者**（`by 著者名` の形式）
- **巻数・シリーズ**（`Volume X of Y` の形式）
- **レーベル・出版社**（タイトル末尾の括弧内）
- **評価**（`X.X out of 5 stars` とレビュー数）
- **KU対象確認**（`Kindle Unlimited` の記載があるブロックのみ対象とし、記載のないタイトルは除外）

**重複除去:** タイトルの先頭20文字をキーとして、複数クエリで同一タイトルが出た場合は1件に統合する。

## Step 5: 結果を出力する

Craftへの保存はシステム側が行うため、以下のMarkdown形式で結果のみを返すこと。
Craftへの保存・ドキュメント作成は自分では行わないこと。

```markdown
## 📚 Kindle Unlimited 対象百合漫画（{実行日 YYYY-MM-DD}）

**クエリ:** {使用したキーワードをカンマ区切りで列挙}
**取得件数:** {重複除去後の件数}件

| タイトル | 著者 | 巻 | レーベル | 評価 |
|---------|------|----|---------|------|
| タイトル1 | 著者1 | 1 of 5 | 百合姫コミックス | ★4.9（622件） |
| タイトル2 | 著者2 | — | ヴァルキリーコミックス | ★4.8（180件） |

※ KU対象タイトルは随時変動します。取得件数はページ1件分の範囲に限定されます。
```

## 注意事項

- Craftへの保存・ドキュメント作成は自分では行わないこと
- 1回のfetchで取得できるのはAmazon検索結果の1ページ分（概ね15〜20件）
- ページネーション（2ページ目以降）は非対応
- KU対象フラグは「Kindle Unlimited」の記載があるブロックのみを対象とする
- 著者・巻数・レーベルが取得できない場合は「—」と記載する
- Amazonの検索結果は日によって順序や件数が変動するため、同じクエリでも毎回同じ結果にはならない
- 第三者サイト（yurinovel.comなど）は参照しないこと。Amazon検索結果のみを情報源とすること
