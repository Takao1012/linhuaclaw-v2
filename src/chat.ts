import * as readline from 'readline';
import { AgentContext, runAgent } from './agent.js';
import { runNews, runTrend, runSeo, runSale, runRanking, runYurinaviNews, runWeekly, runDaily } from './tasks/index.js';
import { saveToCraft, saveDailyToCraft } from './craft.js';

const COMMAND_PROMPT = `あなたはLinhuaClaw v2のコマンド判断AIです。
ユーザーの入力から実行すべきコマンドをJSON形式で返してください。

利用可能なコマンド:
- daily: 今日のBluesky・Reddit・百合ナビをキャッチアップ
- news: 今週の百合漫画ニュースを収集
- trend: SNSトレンドを収集
- seo: SEOデータを確認
- sale: 現在開催中のセール情報を収集
- yurinavi: 百合ナビのニュース一覧を収集
- ranking: pixivコミック・ComicWalker百合ランキングを収集
- weekly: 全タスクをまとめて実行してCraftに保存
- help: 使い方を表示
- exit: 終了

JSONのみ返してください:
{ "command": "コマンド名", "message": "実行内容の一言説明" }

不明な場合:
{ "command": "unknown", "message": "判断できなかった理由" }`;

function printHelp(): void {
  console.log(`
📋 使い方

  デイリーキャッチアップ:
    「今日のキャッチアップして」
    「今日の百合情報を教えて」

  ニュース収集:
    「今週の百合ニュースをまとめて」
    「百合漫画の最新ニュースを教えて」

  SNSトレンド:
    「Blueskyの百合トレンドを教えて」
    「今週の百合SNSの動向は？」

  SEOデータ:
    「今週のSEOを確認して」
    「検索順位はどう？」

  セール情報:
    「百合ナビのニュースを教えて」
    「百合ナビの最新情報を見せて」

  セール情報:
    「今のセール情報を教えて」
    「割引中の百合漫画は？」

  ランキング:
    「百合ランキングを見せて」
    「pixivとComicWalkerのランキングは？」

  全部まとめて（Craftに保存）:
    「今週分全部まとめてCraftに保存して」
    「週次キャッチアップを実行して」

  終了: exit / bye / 終了
  `);
}

async function interpretCommand(
  input: string,
  ctx: AgentContext
): Promise<{ command: string; message: string }> {
  try {
    // LLMはコマンド判断のみ（MCPツールなし・軽量モデル）
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.MODEL_CHAT ?? 'deepseek/deepseek-chat-v3-0324',
        messages: [
          { role: 'system', content: COMMAND_PROMPT },
          { role: 'user', content: input },
        ],
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return { command: 'unknown', message: '判断できませんでした' };
}

export async function runChat(
  ctx: AgentContext,
  craftClient?: import('@modelcontextprotocol/sdk/client/index.js').Client
): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (p: string): Promise<string> => new Promise(r => rl.question(p, r));

  console.log(`
🦞 LinhuaClaw v2 - 対話モード
   「help」で使い方 / 「exit」で終了
  `);

  while (true) {
    const input = (await question('> ')).trim();
    if (!input) continue;

    // 終了
    if (['exit', 'quit', 'bye', '終了', 'q'].includes(input.toLowerCase())) {
      console.log('\n👋 またね！🦞\n');
      rl.close();
      break;
    }

    // help
    if (['help', 'ヘルプ', '使い方'].includes(input.toLowerCase())) {
      printHelp();
      continue;
    }

    // pnpm run xxx または /xxx の直接コマンド
    const directCommand = input.match(/^(?:pnpm run |\/)(\w+)/)?.[1];
    if (directCommand) {
      const { command, message } = { command: directCommand, message: `${directCommand}を実行します` };
      console.log(`  ⚡ ${message}`);
      try {
        await executeCommand(command, ctx, craftClient);
      } catch (e) {
        console.error(`  ❌ エラー: ${(e as Error).message}\n`);
      }
      continue;
    }

    // 自然言語のコマンド判断
    process.stdout.write('  🤔 ...');
    const { command, message } = await interpretCommand(input, ctx);
    process.stdout.write(`\r  ✅ ${message}\n`);

    try {
      await executeCommand(command, ctx, craftClient, message);
    } catch (e) {
      console.error(`  ❌ エラー: ${(e as Error).message}\n`);
    }
  }
}

async function executeCommand(
  command: string,
  ctx: AgentContext,
  craftClient?: import('@modelcontextprotocol/sdk/client/index.js').Client,
  message?: string
): Promise<void> {
  switch (command) {
    case 'daily': {
      const result = await runDaily(ctx);
      if (craftClient) {
        const dateLabel = new Date().toISOString().split('T')[0];
        await saveDailyToCraft(craftClient, dateLabel, result);
      } else {
        console.log(result);
      }
      break;
    }
    case 'news':
      console.log(await runNews(ctx));
      break;
    case 'trend':
      console.log(await runTrend(ctx));
      break;
    case 'seo':
      console.log(await runSeo(ctx));
      break;
    case 'sale':
      console.log(await runSale(ctx));
      break;
    case 'yurinavi':
      console.log(await runYurinaviNews(ctx));
      break;
    case 'ranking':
      console.log(await runRanking(ctx));
      break;
    case 'weekly': {
      const results = await runWeekly(ctx);
      if (craftClient) {
        const weekLabel = new Date().toISOString().split('T')[0];
        await saveToCraft(craftClient, weekLabel, results);
      } else {
        console.log('\n--- ニュース ---\n' + results.news);
        console.log('\n--- トレンド ---\n' + results.trend);
        console.log('\n--- SEO ---\n' + results.seo);
        console.log('\n--- セール ---\n' + results.sale);
        console.log('\n--- ランキング ---\n' + results.ranking);
        console.log('\n--- 百合ナビニュース ---\n' + results.yurinaviNews);
      }
      break;
    }
    case 'unknown':
      console.log(`  ⚠️  ${message ?? '不明なコマンド'}`);
      console.log('  「help」で使い方を確認できます\n');
      break;
    default:
      console.log(`  ⚠️  不明なコマンド: ${command}\n`);
  }
}
