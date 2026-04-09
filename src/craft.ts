import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ドキュメントIDをレスポンスから安全に抽出する
function extractDocId(resultText: string): string | undefined {
  // JSON.parseで正規に取得し、失敗した場合はregexにフォールバック
  try {
    const parsed = JSON.parse(resultText);
    const id = parsed?.documents?.[0]?.id ?? parsed?.id;
    if (id) return id;
  } catch {
    // JSON parse失敗時はregexで試みる
  }
  const idMatch = resultText.match(/"id"\s*:\s*"([^"]+)"/);
  return idMatch?.[1];
}

// Craftに週次キャッチアップドキュメントを作成して保存する
export async function saveToCraft(
  craftClient: Client,
  weekLabel: string,
  contents: { news: string; trend: string; sale: string; ranking: string; yurinaviNews: string }
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

  const docId = extractDocId(resultText);
  if (!docId) {
    console.log('  ⚠️  ドキュメントID取得失敗。Craftへの保存をスキップします。');
    return;
  }

  // コンテンツを追加
  const markdown = `${contents.news}\n\n---\n\n${contents.trend}\n\n---\n\n${contents.sale}\n\n---\n\n${contents.ranking}\n\n---\n\n${contents.yurinaviNews}`;

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

  const docId = extractDocId(resultText);
  if (!docId) {
    console.log('  ⚠️  ドキュメントID取得失敗');
    return;
  }

  await craftClient.callTool({
    name: 'markdown_add',
    arguments: {
      pageId: docId,
      position: 'end',
      markdown: content,
    },
  });

  console.log(`  ✅ Craftに保存完了: ${title}`);
}
