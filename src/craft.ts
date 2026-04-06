import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Craftに週次キャッチアップドキュメントを作成して保存する
export async function saveToCraft(
  craftClient: Client,
  weekLabel: string,
  contents: { news: string; trend: string; seo: string; sale: string; ranking: string; yurinaviNews: string }
): Promise<void> {
  console.log('\n📝 Craftに保存中...');

  const title = `週次キャッチアップ ${weekLabel}`;
  const folderId = process.env.CRAFT_FOLDER_ID;

  // ドキュメント作成
  const createResult = await craftClient.callTool({
    name: 'documents_create',
    arguments: {
      documents: [{ title }],
      ...(folderId ? { destination: { folderId } } : { destination: { destination: 'unsorted' } }),
    },
  });

  const content = createResult.content as Array<{ type: string; text?: string }>;
  const resultText = content.filter(c => c.type === 'text').map(c => c.text ?? '').join('');

  // ドキュメントIDを抽出
  const idMatch = resultText.match(/"id"\s*:\s*"([^"]+)"/);
  if (!idMatch) {
    console.log('  ⚠️  ドキュメントID取得失敗。Craftへの保存をスキップします。');
    return;
  }

  const docId = idMatch[1];

  // コンテンツを追加
  const markdown = `${contents.news}\n\n---\n\n${contents.trend}\n\n---\n\n${contents.seo}\n\n---\n\n${contents.sale}\n\n---\n\n${contents.ranking}\n\n---\n\n${contents.yurinaviNews}`;

  await craftClient.callTool({
    name: 'markdown_add',
    arguments: {
      pageId: docId,
      position: 'end',
      markdown,
    },
  });

  console.log(`  ✅ Craftに保存完了: ${title}`);
}

// デイリーキャッチアップをCraftに保存する
export async function saveDailyToCraft(
  craftClient: Client,
  dateLabel: string,
  content: string
): Promise<void> {
  console.log('\n📝 Craftにデイリーキャッチアップを保存中...');

  const title = `デイリーキャッチアップ ${dateLabel}`;
  const folderId = process.env.CRAFT_DAILY_FOLDER_ID;

  const createResult = await craftClient.callTool({
    name: 'documents_create',
    arguments: {
      documents: [{ title }],
      ...(folderId ? { destination: { folderId } } : { destination: { destination: 'unsorted' } }),
    },
  });

  const resultContent = createResult.content as Array<{ type: string; text?: string }>;
  const resultText = resultContent.filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  const idMatch = resultText.match(/"id"\s*:\s*"([^"]+)"/);

  if (!idMatch) {
    console.log('  ⚠️  ドキュメントID取得失敗');
    return;
  }

  await craftClient.callTool({
    name: 'markdown_add',
    arguments: {
      pageId: idMatch[1],
      position: 'end',
      markdown: content,
    },
  });

  console.log(`  ✅ Craftに保存完了: ${title}`);
}
