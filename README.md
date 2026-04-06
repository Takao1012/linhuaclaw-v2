# 🦞 LinhuaClaw v2

> 琳花ブログ運営のための個人キャッチアップエージェント

百合漫画ブログ運営に必要な情報を自動収集し、Craftに保存する自分専用AIエージェント。
PicoClaw/Siki的なスリムな設計をベースに、Skill文書でLLMをコントロールする。

---

## 設計思想

- **汎用設計 + Skill特化**: agent.tsは汎用、Skillファイルで役割を定義
- **LLMはSkillを読んで判断**: プロンプトだけでなくSkill文書でLLMを安定コントロール
- **コードはMCPを直接呼ばない**: LLMがSkillを読んでMCPを自律的に呼ぶ
- **保存はコードが担当**: LLMはテキストを返すだけ、Craftへの保存はcraft.tsが行う

---

## ファイル構成

```
linhuaclaw-v2/
├── src/
│   ├── index.ts        # CLIエントリーポイント
│   ├── agent.ts        # LLM+MCPコア（StreamableHTTP対応）
│   ├── chat.ts         # 対話モード
│   ├── scheduler.ts    # 週次自動実行（土曜08:00）
│   ├── craft.ts        # Craft保存（週次・デイリー）
│   └── tasks/
│       └── index.ts    # 全タスク定義
├── skills/
│   ├── news.md         # 百合漫画ニュース収集
│   ├── trend.md        # SNSトレンド収集
│   ├── seo.md          # SEOデータ収集
│   ├── sale.md         # セール情報収集
│   ├── ranking.md      # ランキング収集
│   ├── yurinavi-news.md # 百合ナビニュース収集
│   └── daily.md        # デイリーキャッチアップ
├── .mcp.json           # MCPサーバー設定
├── .env                # 環境変数
└── package.json
```

---

## セットアップ

```bash
# 1. インストール
pnpm install
pnpm run build

# 2. 環境変数設定
cp .env.example .env
# .envを編集

# 3. 起動スクリプト設定（任意）
cat > ~/bin/LinhuaClaw << 'SCRIPT'
#!/bin/bash
cd /home/takaonaga/Documents/linhuaclaw-v2
pnpm run chat
SCRIPT
chmod +x ~/bin/LinhuaClaw

cat > ~/bin/LinhuaClawScheduler << 'SCRIPT'
#!/bin/bash
cd /home/takaonaga/Documents/linhuaclaw-v2
pnpm run scheduler
SCRIPT
chmod +x ~/bin/LinhuaClawScheduler
```

---

## 環境変数（.env）

```env
# OpenRouter APIキー
OPENROUTER_API_KEY=sk-or-xxxxxxxxxx

# モデル設定
MODEL_CHAT=deepseek/deepseek-chat-v3-0324    # コマンド判断
MODEL_TASK=deepseek/deepseek-v3.2            # タスク実行

# ブログ設定
BLOG_SITE_URL=https://linhua-blog.com

# Craft設定
CRAFT_FOLDER_ID=xxxxxxxxxx  # 週次キャッチアップ
CRAFT_DAILY_FOLDER_ID=xxxxxxxxxx  # デイリーキャッチアップ
```

---

## .mcp.json

```json
{
  "mcpServers": {
    "brave-search": { "command": "...", "args": [...] },
    "tavily":       { "command": "...", "args": [...] },
    "firecrawl-mcp":{ "command": "...", "args": [...] },
    "craft":        { "url": "https://mcp.craft.do/links/xxx/mcp" },
    "bluesky-mcp":  { "command": "...", "args": [...] },
    "reddit":       { "command": "...", "args": [...] },
    "note-search":  { "command": "...", "args": [...] },
    "gsc":          { "command": "...", "args": [...] },
    "ga4":          { "command": "...", "args": [...] }
  }
}
```

---

## 使い方

### 対話モード

```bash
LinhuaClaw
# または
pnpm run chat
```

```
> /daily              # デイリーキャッチアップ
> /news               # 今週の百合ニュース
> /trend              # SNSトレンド
> /seo                # SEOデータ
> /sale               # セール情報
> /ranking            # ランキング
> /yurinavi           # 百合ナビニュース
> /weekly             # 全タスク実行→Craft保存
> help                # 使い方
> exit                # 終了

# 自然言語でもOK
> 今日のキャッチアップして
> 今週のニュースをまとめて
```

### コマンド直接実行

```bash
pnpm run daily      # デイリーキャッチアップ
pnpm run news       # ニュース収集
pnpm run trend      # トレンド収集
pnpm run seo        # SEOデータ収集
pnpm run sale       # セール情報収集
pnpm run ranking    # ランキング収集
pnpm run yurinavi   # 百合ナビニュース収集
pnpm run weekly     # 全タスク実行→Craft保存
pnpm run scheduler  # スケジューラー起動
```

### スケジューラー

```bash
LinhuaClawScheduler
# または
pnpm run scheduler
```

毎週土曜08:00に週次タスク（6タスク）を自動実行してCraftに保存する。
実行直前にMCPを再接続するため、長時間起動していても問題ない。

---

## タスク一覧

| タスク | 説明 | 主要MCP |
|---|---|---|
| daily | Bluesky・Reddit・百合ナビ（デイリー） | bluesky・reddit・firecrawl |
| news | 百合漫画ニュース（週次） | brave・tavily・firecrawl |
| trend | SNSトレンド（週次） | bluesky・reddit・note |
| seo | SEOデータ（週次） | gsc・ga4 |
| sale | セール情報（週次） | firecrawl |
| ranking | ランキング（週次） | firecrawl |
| yurinavi | 百合ナビニュース一覧（週次） | firecrawl |
| weekly | 上記6タスクをまとめて実行 | — |

---

## Craft保存先

| 種別 | フォルダ |
|---|---|
| 週次キャッチアップ | LinhuaClaw 週次キャッチアップ |
| デイリーキャッチアップ | LinhuaClaw デイリーキャッチアップ |

---

## コスト実績

| モデル | 週次実行（6タスク） |
|---|---|
| DeepSeek V3.2 | ~$0.19/回（月~$0.75） |
| GLM-5 | ~$0.16/回（月~$0.65） |
| デイリー（DeepSeek） | ~$0.02〜0.03/回 |

---

## Skill文書の役割

各Skillファイルは以下を定義する：
- **何を収集するか**（検索クエリ・対象URL）
- **どう整理するか**（フィルタリング・分類）
- **どう出力するか**（フォーマット・文字数）
- **何をしてはいけないか**（Craftへの保存禁止など）

LLMはSkillを読んで自律的にMCPを呼ぶ。
Craftへの保存はLLMではなくcraft.tsのコードが担当する。

---

*LinhuaClaw v2 - 🦞 ロブスターを育てよう*
