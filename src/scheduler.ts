import schedule from 'node-schedule';
import { AgentContext } from './agent.js';
import { runWeekly } from './tasks/index.js';
import { saveToCraft } from './craft.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

export function startScheduler(
  ctx: AgentContext,
  craftClient?: Client
): void {
  // 毎週土曜日 08:00 に実行
  const job = schedule.scheduleJob('0 8 * * 6', async () => {
    const now = new Date();
    console.log(`\n⏰ 週次自動実行開始: ${now.toLocaleString('ja-JP')}`);

    try {
      const results = await runWeekly(ctx);

      if (craftClient) {
        const weekLabel = now.toISOString().split('T')[0];
        await saveToCraft(craftClient, weekLabel, results);
        console.log('✨ 週次キャッチアップをCraftに保存しました');
      } else {
        console.log('\n=== 週次キャッチアップ ===');
        console.log(results.news);
        console.log(results.trend);
        console.log(results.seo);
      }
    } catch (e) {
      console.error(`❌ 週次実行エラー: ${(e as Error).message}`);
    }
  });

  const next = job.nextInvocation();
  console.log(`⏰ スケジューラー起動`);
  console.log(`   次回実行: ${next ? next.toLocaleString('ja-JP') : '不明'}`);
  console.log('   毎週土曜 08:00 に自動実行します');
  console.log('   Ctrl+C で停止\n');
}
