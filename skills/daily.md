# 百合漫画デイリーキャッチアップ Skill

## 概要
Bluesky・Reddit・百合ナビから今日の百合漫画関連情報を収集し、
帰宅後の短時間キャッチアップ用に簡潔にまとめる。

## 重要な制約
- Craftへの保存・ドキュメント作成は絶対にしない
- テキストで結果を返すだけでよい
- 使用するMCPツール: bluesky-mcp・reddit・firecrawl-mcpのみ

## 手順

### Step 1: Bluesky 直近24時間
search_posts で以下を検索（sort="latest"）：
- 「百合漫画」

エンゲージメント（いいね・リポスト）が高い投稿を優先して3〜5件抽出する。

### Step 2: Reddit 当日投稿
search_subreddit で yuri_manga を検索（sort="new", time="day"）

当日の新着投稿を3〜5件抽出する。

### Step 3: 百合ナビ 新着ニュース
firecrawl_scrape で以下を取得する：
- URL: https://yurinavi.com/news-ichiran/
- formats: ["markdown"]

本日または昨日の新着記事のみを抽出する（それ以外はスキップ）。

### Step 4: 要約出力（テキストのみ返す）
以下の形式で簡潔にまとめてテキストで返す：

## 🌙 デイリーキャッチアップ {YYYY-MM-DD}

### Bluesky
- 内容（いいねN）
- 内容（いいねN）

### Reddit r/yuri_manga
- タイトル（スコアN）
- タイトル（スコアN）

### 百合ナビ 新着
- [記事タイトル](URL) - MM/DD

本日の新着がない場合は「本日の新着なし」と記載してスキップする。
全体で10件以内に収める。
