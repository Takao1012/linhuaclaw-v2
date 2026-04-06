# 百合漫画SNSトレンド収集 Skill

## 概要
Bluesky・Reddit・noteから百合漫画の今週のトレンドを収集し、簡潔に要約する。

## 重要な制約
- Craftへの保存・ドキュメント作成は絶対にしない
- テキストで結果を返すだけでよい
- 使用するMCPツール: bluesky-mcp・reddit・note-searchのみ

## 手順

### Step 1: Bluesky検索
search_posts で以下を検索（sort="top"）：
1. 「百合漫画」
2. 「百合 新刊」

### Step 2: Reddit検索
search_subreddit で yuri_manga を検索（sort="top", time="week"）

### Step 3: note検索
search_note_by_tag で「百合漫画」を検索

### Step 4: 要約出力（テキストのみ返す）
以下の形式でまとめてテキストで返す：

## 🐦 SNSトレンド {YYYY-MM-DD}週

**話題作TOP3:**
1. 作品名 - 言及数・反応の傾向
2. 作品名 - 言及数・反応の傾向
3. 作品名 - 言及数・反応の傾向

**今週の傾向:**
（日本語圏・英語圏の反応を一言でまとめる）

**注目ポスト:**
- 内容（ソース: Bluesky/Reddit/note）

データが少ない場合は取得できたソースのみで要約する。
