import 'dotenv/config';
import path from 'path';
import { initMcp, closeMcp, AgentContext } from './agent.js';
import { runNews, runTrend, runSeo, runSale, runRanking, runYurinaviNews, runWeekly, runDaily } from './tasks/index.js';
import { runChat } from './chat.js';
import { startScheduler } from './scheduler.js';
import { saveToCraft, saveDailyToCraft } from './craft.js';

const MCP_CONFIG = path.join(process.cwd(), '.mcp.json');

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY が設定されていません');
    process.exit(1);
  }

  const command = process.argv[2];

  console.log('🦞 LinhuaClaw v2 - 百合ブログ運営キャッチアップエージェント');
  console.log(`   コマンド: ${command ?? '(なし)'}\n`);

  if (!command) {
    console.log('使用可能なコマンド:');
    console.log('  pnpm run chat       # 対話モード');
    console.log('  pnpm run news       # 今週の百合ニュース収集');
    console.log('  pnpm run trend      # SNSトレンド収集');
    console.log('  pnpm run seo        # SEOデータ収集');
    console.log('  pnpm run sale       # セール情報収集');
    console.log('  pnpm run ranking    # 百合ランキング収集');
    console.log('  pnpm run weekly     # 全タスク実行してCraftに保存');
    console.log('  pnpm run scheduler  # スケジューラー起動（毎週土曜08:00）');
    process.exit(0);
  }

  // MCP初期化
  const { clients, tools } = await initMcp(MCP_CONFIG);

  const ctx: AgentContext = {
    apiKey,
    model: process.env.MODEL_TASK ?? 'minimax/minimax-m2.7',
    mcpClients: clients,
    mcpTools: tools,
  };

  // Craftクライアントを取得（あれば）
  const craftClient = clients.get('craft') ?? clients.get('craft-mcp') ?? undefined;

  try {
    switch (command) {
      case 'chat':
        await runChat(ctx, craftClient);
        return; // chatはcleanupをループ内でやる

      case 'news':
        console.log(await runNews(ctx));
        break;

      case 'trend':
        console.log(await runTrend(ctx));
        break;

      case 'seo':
        console.log(await runSeo(ctx));
        break;

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

      case 'yurinavi':
        console.log(await runYurinaviNews(ctx));
        break;

      case 'sale':
        console.log(await runSale(ctx));
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

      case 'scheduler':
        // スケジューラーは実行直前にMCPを再接続するのでctxのみ渡す
        startScheduler(ctx);
        // 起動時のMCPは切断しておく（スケジューラーが再接続する）
        await closeMcp(ctx);
        process.on('SIGINT', async () => {
          console.log('\n👋 スケジューラー停止');
          process.exit(0);
        });
        return; // schedulerはプロセスを維持

      default:
        console.error(`❌ 不明なコマンド: ${command}`);
        process.exit(1);
    }
  } finally {
    await closeMcp(ctx);
  }

  console.log('\n✨ 完了');
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
