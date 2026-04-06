# 百合漫画ランキング収集 Skill

## 概要
pixivコミックとComicWalkerの百合ランキングをスクレイピングして、
今週の注目作品をまとめる。

## 重要な制約
- Craftへの保存・ドキュメント作成は絶対にしない
- テキストで結果を返すだけでよい
- MCPツールはfirecrawl_scrapeのみ使用する

## 手順

### Step 1: pixivコミック百合ランキング取得
firecrawl_scrape で以下を取得する：
- URL: https://comic.pixiv.net/rankings?name=%E7%99%BE%E5%90%88
- formats: ["markdown"]
- waitFor: 3000（JavaScriptレンダリング待機）

取得した内容からTop10のタイトル・順位・作者名を抽出する。
3件しか取れない場合はその旨を記載してスキップする。

### Step 2: ComicWalker百合ランキング取得
firecrawl_scrape で以下を取得する：
- URL: https://comic-walker.com/ranking/yuri
- formats: ["markdown"]

取得した内容からTop10のタイトル・順位・作者名を抽出する。

### Step 3: 要約出力（テキストのみ返す）
以下の形式でまとめてテキストで返す：

## 📊 百合漫画ランキング {YYYY-MM-DD}時点

### pixivコミック 百合ランキング
1. 作品名（作者名）
2. 作品名（作者名）
...

### ComicWalker 百合ランキング
1. 作品名（作者名）
2. 作品名（作者名）
...

**両ランキング共通の作品:**
- 作品名（注目度高）

取得できないページはその旨を記載してスキップする。
