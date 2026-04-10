import schedule from 'node-schedule';
import { AgentContext, initMcp, closeMcp } from './agent.js';
import { runWeekly } from './tasks/index.js';
import { saveToCraft } from './craft.js';
import path from 'path';

const MCP_CONFIG = path.join(process.cwd(), '.mcp.json');

export function startScheduler(ctx: AgentContext): void {
  // 毎週土曜日 08:00 に実行
  const job = schedule.scheduleJob('0 8 * * 6', async () => {
    const now = new Date();
    console.log(`\n⏰ 週次自動実行開始: ${now.toLocaleString('ja-JP')}`);

    // 実行直前にMCPを再接続する
    console.log('📡 MCPサーバーを再接続中...');
    let freshCtx: AgentContext | null = null;

    try {
      const { clients, tools } = await initMcp(MCP_CONFIG);
      freshCtx = {
        ...ctx,
        mcpClients: clients,
        mcpTools: tools,
      };

      const craftClient = clients.get('craft') ?? clients.get('craft-mcp') ?? undefined;

      const results = await runWeekly(freshCtx);

      if (craftClient) {
        const weekLabel = now.toISOString().split('T')[0];
        await saveToCraft(craftClient, weekLabel, results);
        console.log('✨ 週次キャッチアップをCraftに保存しました');
      } else {
        console.log('\n=== 週次キャッチアップ ===');
        console.log(results.news);
        console.log(results.trend);
        console.log(results.sale);
        console.log(results.yurinaviNews);
      }
    } catch (e) {
      console.error(`❌ 週次実行エラー: ${(e as Error).message}`);
    } finally {
      // 実行後にMCPを切断
      if (freshCtx) {
        await closeMcp(freshCtx);
        console.log('📡 MCPサーバーを切断しました');
      }
    }
  });

  const next = job.nextInvocation();
  console.log(`⏰ スケジューラー起動`);
  console.log(`   次回実行: ${next ? next.toLocaleString('ja-JP') : '不明'}`);
  console.log('   毎週土曜 08:00 に自動実行します');
  console.log('   Ctrl+C で停止\n');
}
