# 🦞 LinhuaClaw v2

> 個人ブログ運営のためのキャッチアップエージェント

ブログ運営に必要な情報（ニュース・SNSトレンド・セール情報・ランキング）を自動収集し、Craftに保存する自分専用AIエージェント。

**Skill文書でLLMをコントロールする**アーキテクチャを採用。OpenRouter経由で任意のLLMモデルを使用できる。

---

## 設計思想

- **汎用設計 + Skill特化**: `agent.ts`は汎用、Skillファイルで役割を定義
- **LLMはSkillを読んで判断**: プロンプトだけでなくSkill文書でLLMを安定コントロール
- **コードはMCPを直接呼ばない**: LLMがSkillを読んでMCPを自律的に呼ぶ
- **保存はコードが担当**: LLMはテキストを返すだけ、Craftへの保存は`craft.ts`が行う

---

## ファイル構成

```
linhuaclaw-v2/
├── src/
│   ├── index.ts        # CLIエントリーポイント
│   ├── agent.ts        # LLM+MCPコア（StreamableHTTP対応）
│   ├── chat.ts         # 対話モード
│   ├── scheduler.ts    # 週次自動実行（実行直前MCP再接続方式）
│   ├── craft.ts        # Craft保存（週次・デイリー）
│   └── tasks/
│       └── index.ts    # 全タスク定義
├── skills/
│   ├── daily.md        # デイリーキャッチアップ
│   ├── news.md         # ニュース収集
│   ├── trend.md        # SNSトレンド収集（X含む）
│   ├── sale.md         # セール情報収集
│   ├── ranking.md      # ランキング収集
│   ├── shinkan.md      # 新刊リスト取得
│   ├── ku-catchup.md   # Kindle Unlimited対象漫画取得
│   └── yurinavi-news.md # 百合ナビニュース収集
├── .mcp.json           # MCPサーバー設定
├── .env                # 環境変数
└── package.json
```

---

## セットアップ

### 1. インストール

```bash
git clone https://github.com/your-username/linhuaclaw-v2.git
cd linhuaclaw-v2
pnpm install
pnpm run build
```

### 2. 環境変数設定

```bash
cp .env.example .env
```

`.env`を編集：

```env
# OpenRouter APIキー
OPENROUTER_API_KEY=sk-or-xxxxxxxxxx

# モデル設定
MODEL_CHAT=deepseek/deepseek-chat-v3-0324    # コマンド判断（軽量）
MODEL_TASK=deepseek/deepseek-v3.2            # タスク実行

# ブログ設定
BLOG_SITE_URL=https://your-blog.com

# Craft設定（CraftのフォルダIDを指定）
CRAFT_FOLDER_ID=your-weekly-folder-id
CRAFT_DAILY_FOLDER_ID=your-daily-folder-id
```

### 3. MCPサーバー設定

`.mcp.json`を作成：

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "your-key" }
    },
    "tavily": {
      "command": "npx",
      "args": ["-y", "tavily-mcp"],
      "env": { "TAVILY_API_KEY": "your-key" }
    },
    "firecrawl-mcp": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": { "FIRECRAWL_API_KEY": "your-key" }
    },
    "craft": {
      "url": "https://mcp.craft.do/links/YOUR_LINK/mcp"
    },
    "bluesky-mcp": {
      "command": "npx",
      "args": ["-y", "bluesky-mcp"]
    },
    "reddit": {
      "command": "npx",
      "args": ["-y", "reddit-mcp"]
    },
    "note-search": {
      "command": "node",
      "args": ["/path/to/note-search-mcp/dist/index.js"]
    },
    "x-mcp": {
      "command": "npx",
      "args": ["-y", "x-mcp"],
      "env": { "X_API_KEY": "your-key" }
    }
  }
}
```

> **Note**: CraftはStreamable HTTPトランスポート（`url`で指定）。その他はstdio。  
> X MCPはPay-per-use課金のため、使用しない場合は`"disabled": true`を設定するか省略可能。

### 4. 起動スクリプト設定（任意）

```bash
mkdir -p ~/bin

cat > ~/bin/LinhuaClaw << 'EOF'
#!/bin/bash
cd /path/to/linhuaclaw-v2
pnpm run chat
EOF
chmod +x ~/bin/LinhuaClaw

cat > ~/bin/LinhuaClawScheduler << 'EOF'
#!/bin/bash
cd /path/to/linhuaclaw-v2
pnpm run scheduler
EOF
chmod +x ~/bin/LinhuaClawScheduler

# PATHに追加
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
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
> /daily              # デイリーキャッチアップ → Craft保存
> /news               # 今週のニュース収集
> /trend              # SNSトレンド収集（X含む）
> /sale               # セール情報収集
> /ranking            # ランキング収集
> /shinkan            # 新刊リスト取得 → Craft保存
> /ku                 # Kindle Unlimited対象漫画取得 → Craft保存
> /yurinavi           # 百合ナビニュース収集
> /weekly             # news・trend・sale・yurinaviNewsを実行 → Craft保存
> help                # 使い方を表示
> exit                # 終了

# 自然言語でもOK
> 今日のキャッチアップして
> 今週のニュースをまとめて
> 週次キャッチアップを実行して
```

### コマンド直接実行

```bash
pnpm run daily      # デイリーキャッチアップ → Craft保存
pnpm run news       # ニュース収集
pnpm run trend      # トレンド収集（X含む）
pnpm run sale       # セール情報収集
pnpm run ranking    # ランキング収集
pnpm run shinkan    # 新刊リスト取得 → Craft保存
pnpm run ku         # Kindle Unlimited対象漫画取得 → Craft保存
pnpm run yurinavi   # 百合ナビニュース収集
pnpm run weekly     # news・trend・sale・yurinaviNewsを実行 → Craft保存
pnpm run scheduler  # スケジューラー起動
```

### スケジューラー（自動実行）

```bash
LinhuaClawScheduler
# または
pnpm run scheduler
```

毎週土曜08:00に週次タスクを自動実行してCraftに保存する。  
実行直前にMCPを再接続するため、長時間起動していても接続切れしない。

---

## タスク一覧

| タスク | 頻度 | 説明 | 主要MCP |
|---|---|---|---|
| daily | 毎日（手動） | Bluesky・Reddit・サイト新着 | bluesky・reddit・firecrawl |
| news | 週次 | ニュース収集 | brave・tavily・firecrawl |
| trend | 週次 | SNSトレンド収集 | bluesky・reddit・note・x-mcp |
| sale | 週次 | セール情報収集 | firecrawl |
| ranking | 週次 | ランキング収集 | firecrawl |
| shinkan | 随時（手動） | 今週・来週・再来週の新刊リスト取得 | firecrawl |
| ku | 随時（手動） | Kindle Unlimited対象百合漫画取得 | tavily |
| weekly | 週次（自動） | news・trend・sale・yurinaviNewsをまとめて実行 | — |

---

## Skill文書の役割

各Skillファイル（`skills/*.md`）は以下を定義する：

- **何を収集するか**（検索クエリ・対象URL）
- **どう整理するか**（フィルタリング・分類基準）
- **どう出力するか**（フォーマット・文字数）
- **何をしてはいけないか**（Craftへの保存禁止など）

```markdown
## 重要な制約
- Craftへの保存・ドキュメント作成は絶対にしない
  （保存はコード側が行うため、LLMは関与しない）
- テキストで結果を返すだけでよい
```

LLMはSkillを読んで自律的にMCPを呼ぶ。Craftへの保存はLLMではなく`craft.ts`のコードが担当する。

---

## カスタマイズ方法

### 新しいタスクの追加

1. `skills/your-task.md` を作成（収集手順・出力フォーマットを記述）
2. `src/tasks/index.ts` に `runYourTask()` を追加
3. `src/chat.ts` と `src/index.ts` にコマンドを追加
4. `package.json` にスクリプトを追加
5. `pnpm run build`

Skillファイルを追加するだけで新しい情報源やトピックに対応できる。

### モデルの変更

`.env`の`MODEL_TASK`を変更するだけで任意のOpenRouterモデルに切り替えられる：

```env
MODEL_TASK=deepseek/deepseek-v3.2     # 高品質・コスパ優秀
MODEL_TASK=zhipuai/glm-5              # 読みやすい出力
MODEL_TASK=minimax/minimax-m2.7       # ツールコール安定
```

---

## コスト目安

OpenRouter経由でのコスト実績（参考値）：

| モデル | 週次実行（5タスク） | デイリー |
|---|---|---|
| DeepSeek V3.2 | ~$0.19/回 | ~$0.03/回 |
| GLM-5 | ~$0.16/回 | — |

X MCP: ~$0.005/件（週次trendで10件取得の場合 +$0.05/回）  
月換算でも数百円程度で運用可能。

---

## 必要なもの

- Node.js 18+
- pnpm
- OpenRouter APIキー
- Craft（MCPリンク設定済み）
- 各MCPサーバーのAPIキー（Brave Search・Tavily・Firecrawl等）

---

## License

MIT

---

*🦞 ロブスターを育てよう*
