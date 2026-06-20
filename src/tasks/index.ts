import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { AgentContext, runAgent, loadSkill, loadSkills, callMcpToolDirect, parseMcpJson } from '../agent.js';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

// ─── 共通ユーティリティ ───────────────────────────────────────

export function resolveInput(input: string): string {
  const expanded = input.startsWith('~/')
    ? path.join(process.env.HOME ?? '', input.slice(2))
    : input;

  if (expanded.endsWith('.md') && fs.existsSync(expanded)) {
    console.log(`  📄 ファイルを読み込み: ${expanded}`);
    return fs.readFileSync(expanded, 'utf-8');
  }

  return input;
}

/** ファイルパスを解決して返す（内容展開はしない） */
function resolvePath(input: string): string {
  return input.startsWith('~/')
    ? path.join(process.env.HOME ?? '', input.slice(2))
    : input;
}

// ─── タスク定義 ───────────────────────────────────────────────

export async function runAffiliate(
  ctx: AgentContext,
  input: string,
  articleType?: 'review' | 'summary'
): Promise<string> {
  let skill = loadSkill('affiliate');

  // 記事種別に応じてトラッキングIDを差し替え
  const trackingId = articleType === 'summary'
    ? 'txkxo1012-summary-22'
    : articleType === 'review'
    ? 'txkxo1012-review-22'
    : 'txkxo1012-22'; // デフォルト（新刊リスト用）

  if (articleType) {
    skill = skill.replace(/txkxo1012-22/g, trackingId);
    console.log(`  🏷️  トラッキングID: ${trackingId}`);
  }

  // .mdファイルが渡された場合はループ処理に委譲
  const expandedInput = input.startsWith('~/')
    ? path.join(process.env.HOME ?? '', input.slice(2))
    : input;
  if (expandedInput.endsWith('.md') && fs.existsSync(expandedInput)) {
    return runAffiliateFromMd(ctx, expandedInput, articleType);
  }

  const prompt = `次の作品のAmazonアフィリエイトリンクを生成してください: ${input}`;
  return runAgent(prompt, skill, ctx);
}

/** .mdファイルからタイトルまたはASIN/URLを抽出し、1件ずつループしてアフィリエイトリンクを生成する */
async function runAffiliateFromMd(
  ctx: AgentContext,
  mdPath: string,
  articleType?: 'review' | 'summary'
): Promise<string> {
  const content = fs.readFileSync(mdPath, 'utf-8');

  // 記事種別に応じてトラッキングIDを決定
  const trackingId = articleType === 'summary'
    ? 'txkxo1012-summary-22'
    : articleType === 'review'
    ? 'txkxo1012-review-22'
    : 'txkxo1012-22';
  let skill = loadSkill('affiliate');
  if (articleType) {
    skill = skill.replace(/txkxo1012-22/g, trackingId);
  }

  // ASIN（10桁英数字）またはAmazon商品URL（/dp/XXXXXXXXXX/）を含む行があれば
  // ASIN直接モードのリストとして扱い、タイトル抽出をスキップする
  const asinLinePattern = /(?:\/dp\/([A-Z0-9]{10})|(?<![A-Z0-9])([A-Z0-9]{10})(?![A-Z0-9]))/i;
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const asinLines = lines.filter(l => asinLinePattern.test(l));

  let entries: string[];
  let isAsinMode = false;

  if (asinLines.length > 0) {
    // ASIN直接モード: 各行をそのままエージェントへの入力として渡す
    console.log(`  🔢 ASIN直接モードとして処理: ${asinLines.length}件`);
    entries = asinLines;
    isAsinMode = true;
  } else {
    // 検索モード: タイトル一覧をJSONで抽出（軽量プロンプト）
    console.log('  📋 作品タイトルを抽出中...');
    const extractPrompt = `以下の記事に登場する作品タイトルと巻数をJSON配列で返してください。
形式: ["タイトルA 1巻", "タイトルB", ...]
他のテキストは一切出力しないこと。JSONのみ出力すること。

${content}`;

    let titles: string[] = [];
    try {
      const raw = await runAgent(extractPrompt, '', { ...ctx, mcpTools: [] });
      // コードブロックやバッククォートを除去してからパース
      const cleaned = raw.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
      titles = JSON.parse(cleaned);
      console.log(`  ✅ ${titles.length}件のタイトルを抽出: ${titles.join(', ')}`);
    } catch (e) {
      return `❌ タイトル抽出に失敗しました: ${(e as Error).message}`;
    }

    if (titles.length === 0) {
      return '⚠️ 記事から作品タイトルが見つかりませんでした。';
    }
    entries = titles;
  }

  // Step2: 1件ずつループしてアフィリエイトリンクを生成
  const results: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    console.log(`  🔗 [${i + 1}/${entries.length}] ${entry}`);
    try {
      const prompt = isAsinMode
        ? `次のASIN（または作品名とASIN）からAmazonアフィリエイトリンクを生成してください: ${entry}`
        : `次の作品のAmazonアフィリエイトリンクを生成してください: ${entry}`;
      const link = await runAgent(prompt, skill, ctx);
      results.push(link);
    } catch (e) {
      console.warn(`  ⚠️  スキップ: ${entry} - ${(e as Error).message}`);
      results.push(`<!-- affiliate取得失敗: ${entry} -->`);
    }
  }

  const summary = `✅ ${results.filter(r => !r.startsWith('<!--')).length}/${entries.length}件完了`;
  console.log(`  ${summary}`);
  return results.join('\n\n') + `\n\n---\n${summary}`;
}

export async function runSlug(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('slug');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の記事のWordPressスラッグ候補を3つ生成してください。\n\n${resolved}`
    : `次の記事タイトルのWordPressスラッグ候補を3つ生成してください: ${resolved}`;
  return runAgent(prompt, skill, ctx);
}

export async function runCover(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('cover');

  // .mdファイルが渡された場合はループ処理に委譲
  const expandedInput = input.startsWith('~/')
    ? path.join(process.env.HOME ?? '', input.slice(2))
    : input;
  if (expandedInput.endsWith('.md') && fs.existsSync(expandedInput)) {
    return runCoverFromMd(ctx, expandedInput);
  }

  // 単体: そのままエージェントに渡す
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の記事から作品タイトルを抽出し、表紙画像を取得してWordPressにアップロードしてください。\n\n${resolved}`
    : `次の作品の表紙画像を取得してWordPressにアップロードしてください: ${resolved}`;
  return runAgent(prompt, skill, ctx);
}

/** .mdファイルからタイトルを抽出し、1件ずつループして表紙画像を取得する */
async function runCoverFromMd(ctx: AgentContext, mdPath: string): Promise<string> {
  const content = fs.readFileSync(mdPath, 'utf-8');
  const skill = loadSkill('cover');

  // Step1: タイトル一覧をJSONで抽出（ツールなし・軽量プロンプト）
  console.log('  📋 作品タイトルを抽出中...');
  const extractPrompt = `以下の記事に登場する作品タイトルと巻数をJSON配列で返してください。
形式: ["タイトルA 1巻", "タイトルB", ...]
他のテキストは一切出力しないこと。JSONのみ出力すること。

${content}`;

  let titles: string[] = [];
  try {
    const raw = await runAgent(extractPrompt, '', { ...ctx, mcpTools: [] });
    const cleaned = raw.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    titles = JSON.parse(cleaned);
    console.log(`  ✅ ${titles.length}件のタイトルを抽出: ${titles.join(', ')}`);
  } catch (e) {
    return `❌ タイトル抽出に失敗しました: ${(e as Error).message}`;
  }

  if (titles.length === 0) {
    return '⚠️ 記事から作品タイトルが見つかりませんでした。';
  }

  // Step2: 1件ずつループして表紙画像を取得（失敗時はスキップ）
  const results: Array<{ title: string; result: string; ok: boolean }> = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    console.log(`  🖼️  [${i + 1}/${titles.length}] ${title}`);
    try {
      const res = await runAgent(
        `次の作品の表紙画像を取得してWordPressにアップロードしてください: ${title}`,
        skill,
        ctx
      );
      results.push({ title, result: res, ok: true });
    } catch (e) {
      const msg = `❌ 取得失敗: ${(e as Error).message}`;
      console.warn(`  ⚠️  スキップ: ${title} - ${(e as Error).message}`);
      results.push({ title, result: msg, ok: false });
    }
  }

  // 結果をテーブル形式でまとめる
  const okCount = results.filter(r => r.ok).length;
  const summary = `✅ ${okCount}/${titles.length}件完了`;
  console.log(`  ${summary}`);

  const details = results
    .map((r, idx) => `### ${idx + 1}. ${r.title}\n${r.result}`)
    .join('\n\n');

  return `${details}\n\n---\n${summary}`;
}

export async function runEyecatch(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('eyecatch');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の記事内容に合ったアイキャッチ画像を生成してローカルに保存してください。\n\n${resolved}`
    : `次の内容に合ったアイキャッチ画像を生成してローカルに保存してください: ${resolved}`;
  return runAgent(prompt, skill, ctx);
}

export async function runSns(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('sns');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の記事のSNS投稿文（X・Bluesky・Instagram）を作成してください。\n\n${resolved}`
    : `次の内容のSNS投稿文（X・Bluesky・Instagram）を作成してください: ${resolved}`;
  return runAgent(prompt, skill, ctx);
}

export async function runVoice(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('voice');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下のテキストを琳花ちゃんの語り口に変換してください。\n\n${resolved}`
    : `次のテキストを琳花ちゃんの語り口に変換してください: ${resolved}`;
  return runAgent(prompt, skill, ctx);
}

export async function runPublish(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('publish');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の記事をWordPressに下書き投稿してください。\n\n${resolved}`
    : `次のファイルをWordPressに下書き投稿してください: ${resolved}`;
  return runAgent(prompt, skill, ctx);
}

export async function runShinkan(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('shinkan');
  const period = input.trim() || getDefaultPeriod();

  // カレンダーページを事前fetchしてプロンプトに埋め込む
  console.log('  📡 百合ナビカレンダーを取得中...');
  let calendarMarkdown = '';
  try {
    const res = await fetch('https://yurinavi.com/yuri-calendar/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinhuaFamiliar/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    calendarMarkdown = await res.text();
    console.log(`  ✅ カレンダー取得完了 (${calendarMarkdown.length}文字)`);
  } catch (e) {
    console.log(`  ⚠️  カレンダー取得失敗: ${(e as Error).message}`);
  }

  const prompt = calendarMarkdown
    ? `以下は百合ナビのカレンダーページの内容です。この中から ${period} の期間に発売される漫画作品を抽出して出力してください。\n\n---\n${calendarMarkdown}\n---`
    : `百合ナビから以下の期間の新刊情報を取得してください: ${period}`;

  // カレンダーページのみで完結（個別ページ取得なし）
  const shinkanCtx = { ...ctx, mcpTools: [] };
  return runAgent(prompt, skill, shinkanCtx);
}

// ─── summary（まとめ記事生成） ───────────────────────────────

export async function runSummary(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkills('linhua-voice-jp', 'summary');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の作品データをもとに、琳花ちゃんの語り口でまとめ記事を生成してください。\n\n${resolved}`
    : `次のファイルの作品データをもとに、まとめ記事を生成してください: ${resolved}`;

  // MCPツール不要（LLMのみで処理）
  const summaryCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, summaryCtx);

  // mdファイルに自動保存
  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `summary-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── newlist（新刊リスト記事生成） ──────────────────────────

export async function runNewlist(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkills('linhua-voice-jp', 'newlist');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の新刊データをもとに、琳花ちゃんの語り口で新刊リスト記事を生成してください。\n\n${resolved}`
    : `次のファイルの新刊データをもとに、新刊リスト記事を生成してください: ${resolved}`;

  // MCPツール不要（LLMのみで処理）
  const newlistCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, newlistCtx);

  // mdファイルに自動保存
  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `newlist-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── genre-list（ジャンル×百合マンガ 作品リスト収集） ────────

export async function runGenreList(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('genre-list');
  const prompt = `次のジャンルの百合マンガ作品リストを収集してください: ${input}`;
  const result = await runAgent(prompt, skill, ctx);

  // mdファイルに自動保存
  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `genre-list-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}

---
📄 保存先: ${outPath}`;
}

// ─── author-research（百合漫画作家リサーチ） ─────────────────

export async function runAuthorResearch(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('author-research');
  const prompt = `次の百合漫画作家の全作品・プロフィール・SNS情報を調査してください: ${input}`;
  const result = await runAgent(prompt, skill, ctx);

  // mdファイルに自動保存
  const today = new Date().toISOString().split('T')[0];
  const safeName = input.replace(/[\s/\\]/g, '-').slice(0, 30);
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `author-research-${safeName}-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── mangaka-list（作家作品リスト記事生成） ──────────────────

export async function runMangakaList(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkills('linhua-voice-jp', 'mangaka-list');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の作家データをもとに、琳花ちゃんの語り口で作家作品リスト記事を生成してください。\n\n${resolved}`
    : `次のファイルの作家データをもとに、作家作品リスト記事を生成してください: ${resolved}`;

  // MCPツール不要（LLMのみで処理）
  const mangakaCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, mangakaCtx);

  // mdファイルに自動保存（作家名をファイル名に含める）
  const today = new Date().toISOString().split('T')[0];
  const authorName = resolved.match(/マンガ家名[:：]\s*(.+)/)?.[1]?.trim().slice(0, 20) ?? 'unknown';
  const safeName = authorName.replace(/[\s/\\]/g, '-');
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `mangaka-list-${safeName}-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── weekly-flash（週次速報ブログ記事生成） ──────────────────

export async function runWeeklyFlash(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkills('linhua-voice-jp', 'weekly-flash');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下のデイリーキャッチアップデータをもとに、今週の百合マンガシーン速報ブログ記事を生成してください。\n\n${resolved}`
    : `次のファイルのデイリーキャッチアップデータをもとに、週次速報記事を生成してください: ${resolved}`;

  const flashCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, flashCtx);

  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `weekly-flash-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── monthly-note（月次note記事生成） ────────────────────────

export async function runMonthlyNote(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkills('linhua-voice-jp', 'monthly-note');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の週次キャッチアップデータをもとに、百合マンガシーン月次観察記のnote記事を生成してください。\n\n${resolved}`
    : `次のファイルの週次キャッチアップデータをもとに、月次note記事を生成してください: ${resolved}`;

  const noteCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, noteCtx);

  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `monthly-note-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── review（レビュー記事生成） ──────────────────────────────

export async function runReview(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkills('linhua-voice-jp', 'review');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の作品情報・感想メモをもとに、琳花ちゃんの語り口でレビュー記事を生成してください。前巻記事が含まれている場合は続巻モードで作成してください。\n\n${resolved}`
    : `次のファイルの内容をもとに、レビュー記事を生成してください: ${resolved}`;

  const reviewCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, reviewCtx);

  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `review-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── suggest-links（Aプラン：会話履歴で多段階対応） ──────────

export async function runSuggestLinks(
  ctx: AgentContext,
  input: string
): Promise<string> {
  const articlePath = resolvePath(input);

  if (!fs.existsSync(articlePath)) {
    return `❌ ファイルが見つかりません: ${articlePath}`;
  }

  const articleContent = fs.readFileSync(articlePath, 'utf-8');

  const ragUrl = process.env.RAG_SERVER_URL ?? 'http://127.0.0.1:7891';

  console.log('  🔍 RAGサーバーに接続中...');

  try {
    const health = await fetch(`${ragUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!health.ok) throw new Error('RAGサーバーが応答しません');
    console.log('  ✅ RAGサーバー接続OK');
  } catch (e) {
    return `❌ RAGサーバーに接続できません (${ragUrl})\n   LinhuaMemory を起動してから再実行してください\n   ${(e as Error).message}`;
  }

  const queryText = articleContent.slice(0, 500).replace(/[#\n]+/g, ' ').trim();

  console.log('  🔍 内部リンク候補を検索中...');
  let candidates: unknown[] = [];
  try {
    const res = await fetch(
      `${ragUrl}/search?q=${encodeURIComponent(queryText)}&k=10&mode=hybrid`,
      { signal: AbortSignal.timeout(15_000) }
    );
    const data = await res.json() as { results: unknown[] };
    candidates = data.results ?? [];
    console.log(`  ✅ ${candidates.length}件の候補を取得`);
  } catch (e) {
    return `❌ RAG検索に失敗しました: ${(e as Error).message}`;
  }

  if (candidates.length === 0) {
    return '🔍 内部リンク候補が見つかりませんでした。';
  }

  const existingLinks = [...articleContent.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
    .map(m => m[2]);
  const existingLinksText = existingLinks.length > 0
    ? existingLinks.join('\n')
    : 'なし';

  const prompt = `以下の記事に対して、内部リンクを挿入する候補と挿入箇所を提案してください。

## 対象記事
ファイルパス: ${articlePath}

${articleContent}

## 記事内の既存リンク（提案から除外すること）
${existingLinksText}

## RAG検索で見つかった関連記事候補
${JSON.stringify(candidates, null, 2)}

## 指示
1. 上記の候補から関連性の高い記事を最大5件選んでください
2. 【重要】既存リンクと同じURLや同じ記事への重複リンクは提案しないでください
3. それぞれについて「どのセクションのどの文の後に挿入するか」を具体的に示してください
4. リンクの挿入文は「〇〇について詳しくはこちら👇\n[記事タイトル](ファイル名)」の形式で提案してください
5. 無理に入れる必要のない候補はスキップしてください

番号付きリストで提案してください。後続の apply-links コマンドで「1と3を反映して」のように指定できます。`;

  return runAgent(prompt, `あなたはブログの内部リンク最適化を行うアシスタントです。自然な文脈でリンクを挿入し、読者の回遊を促す提案をしてください。`, ctx);
}

// ─── apply-links ──────────────────────────────────────────────

export async function runApplyLinks(
  ctx: AgentContext,
  input: string,
  suggestionContext: string
): Promise<string> {
  const articlePath = resolvePath(input);

  if (!fs.existsSync(articlePath)) {
    return `❌ ファイルが見つかりません: ${articlePath}`;
  }

  const articleContent = fs.readFileSync(articlePath, 'utf-8');

  if (!suggestionContext) {
    return `❌ 反映する内部リンク提案が見つかりません。先に suggest-links を実行してください。`;
  }

  const prompt = `以下の記事に、提案された内部リンクを反映してください。

## 対象記事
ファイルパス: ${articlePath}

${articleContent}

## 反映する提案
${suggestionContext}

## 指示
- 提案内容を記事に反映した完全なMarkdownを出力してください
- 【最重要】記事内の既存リンクは絶対に削除・変更・移動しないでください
- 新しいリンクは提案で指定された箇所にのみ追加してください
- リンクの形式は「[記事タイトル](ファイル名)」のMarkdownリンク形式を維持してください
- 記事の本文・構成・語り口は変えないでください
- 出力はMarkdown本文のみ（説明文・コードブロック不要）`;

  const applyCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(
    prompt,
    `あなたはMarkdown記事の編集アシスタントです。指示された内部リンクを記事に反映し、完全なMarkdownを出力してください。`,
    applyCtx
  );

  try {
    fs.writeFileSync(articlePath, result, 'utf-8');
    console.log(`  ✅ ファイルを更新しました: ${articlePath}`);
    return `✅ 内部リンクを反映しました: ${articlePath}\n\n--- 更新後のファイル先頭 ---\n${result.slice(0, 300)}...`;
  } catch (e) {
    return `❌ ファイル保存に失敗しました: ${(e as Error).message}\n\n--- 反映後の内容 ---\n${result}`;
  }
}

export async function runSuggestLinksToFile(
  ctx: AgentContext,
  input: string
): Promise<string> {
  const result = await runSuggestLinks(ctx, input);

  const articlePath = resolvePath(input);
  const suggestPath = articlePath.replace(/\.md$/, '.suggest.md');

  try {
    fs.writeFileSync(suggestPath, result, 'utf-8');
    console.log(`  ✅ 提案をファイルに保存しました: ${suggestPath}`);
    return `${result}\n\n---\n📄 提案を保存しました: ${suggestPath}\n反映する場合: apply-links ${input}`;
  } catch (e) {
    return result;
  }
}

// ─── related-posts ────────────────────────────────────────────

export async function runRelatedPosts(
  ctx: AgentContext,
  input: string
): Promise<string> {
  const articlePath = resolvePath(input);

  if (!fs.existsSync(articlePath)) {
    return `❌ ファイルが見つかりません: ${articlePath}`;
  }

  const articleContent = fs.readFileSync(articlePath, 'utf-8');

  const ragUrl = process.env.RAG_SERVER_URL ?? 'http://127.0.0.1:7891';

  console.log('  🔍 RAGサーバーに接続中...');

  try {
    const health = await fetch(`${ragUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!health.ok) throw new Error('RAGサーバーが応答しません');
    console.log('  ✅ RAGサーバー接続OK');
  } catch (e) {
    return `❌ RAGサーバーに接続できません (${ragUrl})\n   LinhuaMemory を起動してから再実行してください\n   ${(e as Error).message}`;
  }

  const queryText = articleContent.slice(0, 500).replace(/[#\n]+/g, ' ').trim();

  console.log('  🔍 関連記事候補を検索中...');
  let results: Array<{ file_path: string; chunk_index: number; content: string; score: number }> = [];
  try {
    const res = await fetch(
      `${ragUrl}/search?q=${encodeURIComponent(queryText)}&k=8&mode=hybrid`,
      { signal: AbortSignal.timeout(15_000) }
    );
    const data = await res.json() as { results: typeof results };
    results = data.results ?? [];
    console.log(`  ✅ ${results.length}件の候補を取得`);
  } catch (e) {
    return `❌ RAG検索に失敗しました: ${(e as Error).message}`;
  }

  const selfName = path.basename(articlePath);
  const seen = new Set<string>();
  const candidates = results.filter(r => {
    const fname = path.basename(r.file_path);
    if (fname === selfName || seen.has(fname)) return false;
    seen.add(fname);
    return true;
  }).slice(0, 5);

  if (candidates.length === 0) {
    return '🔍 関連記事候補が見つかりませんでした。';
  }

  const existingLinks = [...articleContent.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
    .map(m => m[2]);
  const filtered = candidates.filter(c => {
    const base = path.basename(c.file_path, '.md');
    return !existingLinks.some(link => link.includes(base));
  });

  if (filtered.length === 0) {
    return '🔍 新規の関連記事候補が見つかりませんでした（既存リンクと重複）。';
  }

  const items = filtered.map(c => {
    const fm = c.content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    const title = fm ? fm[1] : path.basename(c.file_path, '.md');
    return `- [${title}](${c.file_path})`;
  });

  const section = `\n\n---\n\n## 関連記事\n\n${items.join('\n')}\n`;

  try {
    fs.appendFileSync(articlePath, section, 'utf-8');
    console.log(`  ✅ 関連記事セクションを追加しました: ${articlePath}`);
    return `✅ 関連記事を追記しました: ${articlePath}\n\n${section}`;
  } catch (e) {
    return `❌ ファイル保存に失敗しました: ${(e as Error).message}\n\n${section}`;
  }
}

// ─── synopsis ─────────────────────────────────────────────────

export async function runSynopsis(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('synopsis');

  const expandedInput = input.startsWith('~/')
    ? path.join(process.env.HOME ?? '', input.slice(2))
    : input;
  if (expandedInput.endsWith('.md') && fs.existsSync(expandedInput)) {
    return runSynopsisFromMd(ctx, expandedInput);
  }

  const prompt = `次の作品のあらすじ・作品情報を取得してください: ${input}`;
  return runAgent(prompt, skill, ctx);
}

async function runSynopsisFromMd(ctx: AgentContext, mdPath: string): Promise<string> {
  const skill = loadSkill('synopsis');
  const content = fs.readFileSync(mdPath, 'utf-8');

  console.log('  📋 作品タイトルを抽出中...');
  const extractPrompt = `以下の新刊リストに登場する作品タイトルと巻数をJSON配列で返してください。
形式: ["タイトルA 2巻", "タイトルB 1巻", ...]
他のテキストは一切出力しないこと。JSONのみ出力すること。

${content}`;

  let titles: string[] = [];
  try {
    const raw = await runAgent(extractPrompt, '', { ...ctx, mcpTools: [] });
    const cleaned = raw.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    titles = JSON.parse(cleaned);
    console.log(`  ✅ ${titles.length}件のタイトルを抽出: ${titles.join(', ')}`);
  } catch (e) {
    return `❌ タイトル抽出に失敗しました: ${(e as Error).message}`;
  }

  if (titles.length === 0) {
    return '⚠️ ファイルから作品タイトルが見つかりませんでした。';
  }

  const results: string[] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    console.log(`  📖 [${i + 1}/${titles.length}] ${title}`);
    try {
      const result = await runAgent(
        `次の作品のあらすじ・作品情報を取得してください: ${title}`,
        skill,
        ctx
      );
      results.push(result);
    } catch (e) {
      console.warn(`  ⚠️  スキップ: ${title} - ${(e as Error).message}`);
      results.push(`## ${title}\n取得失敗: ${(e as Error).message}`);
    }
  }

  const okCount = results.filter(r => !r.includes('取得失敗')).length;
  const summary = `✅ ${okCount}/${titles.length}件完了`;
  console.log(`  ${summary}`);
  return results.join('\n\n---\n\n') + `\n\n---\n${summary}`;
}

// ─── newsletter-gen ───────────────────────────────────────────

export async function runNewsletterGen(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('newsletter');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の週次キャッチアップデータをもとに、琳花ちゃんの語り口でニュースレター原稿を生成してください。\n\n${resolved}`
    : `次のファイルの内容をもとに、ニュースレター原稿を生成してください: ${resolved}`;

  const nlCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, nlCtx);

  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(process.env.DRAFT_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'drafts'), `newsletter-${today}.md`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}\n✏️  内容を確認後、newsletter-post ${outPath} で投稿できます`;
}

// ─── search ───────────────────────────────────────────────────

export async function runSearch(ctx: AgentContext, query: string): Promise<string> {
  if (!query?.trim()) {
    return '❌ 検索クエリを指定してください。例: search 百合マンガ 新刊';
  }
  const skill = loadSkill('search');
  const prompt = `「${query}」でWeb（Brave）とBlueskyを検索して、結果をまとめてください。`;
  return runAgent(prompt, skill, ctx);
}

// ─── summarize ────────────────────────────────────────────────

export async function runSummarize(ctx: AgentContext, input: string): Promise<string> {
  if (!input?.trim()) {
    return '❌ URLまたはテキストを指定してください。例: summarize https://example.com/article';
  }
  const skill = loadSkill('summarize');
  const isUrl = /^https?:\/\//.test(input.trim());
  const prompt = isUrl
    ? `次のURLの内容を取得して要約してください: ${input.trim()}`
    : `次のテキストを要約してください:\n\n${input.trim()}`;
  return runAgent(prompt, skill, ctx);
}

// ─── news-digest ──────────────────────────────────────────────

export async function runNewsDigest(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('news-digest');
  const resolved = resolveInput(input);
  const prompt = resolved !== input
    ? `以下の5日分のAIニュース素材をもとに、noteブログ用の週次AIニュースダイジェスト記事を生成してください。\n\n${resolved}`
    : `次のファイルの内容をもとに、週次AIニュースダイジェスト記事を生成してください: ${resolved}`;

  const digestCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, digestCtx);

  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(
    process.env.NOTE_DIR ?? path.join(process.env.HOME ?? '', 'Fujitsu_Chromebook', 'Output', 'note用'),
    `ai-news-digest-${today}.md`
  );
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── daily-ai-news ────────────────────────────────────────────

export async function runDailyAiNews(ctx: AgentContext): Promise<string> {
  const skill = loadSkill('daily-ai-news');
  const today = new Date().toISOString().split('T')[0];
  const outPath = path.join(
    process.env.NOTE_DIR ?? path.join(process.env.HOME ?? '', 'Fujitsu_Chromebook', 'Output', 'note用'),
    `ai-news-${today}.md`
  );

  const prompt = `今日（${today}）のAI・LLM関連ニュースを収集して、Skillの手順に従ってMarkdown素材を生成してください。
出力はMarkdownテキストのみ返してください（ファイル保存はシステムが行います）。`;

  const result = await runAgent(prompt, skill, ctx);

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── newsblur-digest ──────────────────────────────────────────

/** NewsBlur APIの folders は「フォルダ名→(フィードIDの配列 | 子フォルダを含む混在配列)」という
 *  不定形構造で返ってくる（公式ドキュメントに正確なスキーマの明記がないため、複数の形に耐えるよう
 *  再帰的に解釈する）。想定される要素パターン:
 *   - 数値                          → 未分類フィードのID（フォルダ名なし）
 *   - { "フォルダ名": [...] }       → フォルダとその中身（中身は数値 or 子フォルダの配列）
 *   - { folder_name, feeds, folders } → list_feeds実装側で型注釈されている整形済み形式（保険）
 */
interface NewsblurFolderMap {
  /** フォルダ名（部分一致用に正規化済み） → 直属のフィードID一覧 */
  [folderName: string]: number[];
}

/** list_feeds が返す folders 生データを再帰的に走査し、フォルダ名→フィードID一覧に変換する */
function flattenNewsblurFolders(rawFolders: unknown): NewsblurFolderMap {
  const map: NewsblurFolderMap = {};

  const visit = (node: unknown, currentFolderName: string | null) => {
    if (typeof node === 'number') {
      // 未分類、または親フォルダ直属のフィードID
      if (currentFolderName) {
        (map[currentFolderName] ??= []).push(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child, currentFolderName);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;

      // 保険: { folder_name, feeds, folders } 形式（types.ts の NewsBlurFolder 型）に対応
      if ('folder_name' in obj) {
        const name = String(obj.folder_name);
        const feeds = Array.isArray(obj.feeds) ? obj.feeds : [];
        for (const f of feeds) {
          const id = typeof f === 'number' ? f : (f as { id?: number })?.id;
          if (typeof id === 'number') (map[name] ??= []).push(id);
        }
        if (Array.isArray(obj.folders)) {
          for (const child of obj.folders) visit(child, name);
        }
        return;
      }

      // 通常形: { "フォルダ名": [...] }（キーが複数あるケースも一応許容）
      for (const [key, value] of Object.entries(obj)) {
        visit(value, key);
      }
      return;
    }
  };

  visit(rawFolders, null);
  return map;
}

/** フォルダ名の部分一致でフィードIDを集める。複数フォルダ名にヒットした場合は重複排除する。 */
function extractFeedIdsByFolderNames(
  folderMap: NewsblurFolderMap,
  targetFolderNamePatterns: string[]
): { matchedFolders: string[]; feedIds: number[] } {
  const matchedFolders: string[] = [];
  const feedIdSet = new Set<number>();

  for (const [folderName, feedIds] of Object.entries(folderMap)) {
    const isMatch = targetFolderNamePatterns.some(pattern => folderName.includes(pattern));
    if (isMatch) {
      matchedFolders.push(folderName);
      for (const id of feedIds) feedIdSet.add(id);
    }
  }

  return { matchedFolders, feedIds: [...feedIdSet] };
}

interface NewsblurStory {
  id: string;
  hash: string;
  title: string;
  content: string;
  date: string;
  permalink: string;
  authors: string;
  tags: string[];
  isRead: boolean;
  isStarred: boolean;
}

const YURI_KEYWORDS = ['百合', '百合マンガ', '百合漫画', '百合作品', 'yuri', 'yuri manga'];

/** タイトル・本文に百合関連語が含まれるか（大文字小文字を区別しない部分一致） */
function matchesYuriKeyword(story: NewsblurStory): boolean {
  const haystack = `${story.title} ${story.content}`.toLowerCase();
  return YURI_KEYWORDS.some(kw => haystack.includes(kw.toLowerCase()));
}

/** HTML本文から簡易的にタグを除去する（要約用途なので厳密なサニタイズは不要） */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // 一部のフィードは本文中にリテラルの "\n"（バックスラッシュ+n の2文字）がエスケープされず
    // 混入していることがある（実際の改行コードではないため \s+ では除去されない）。
    // これをそのままLLMに渡すと要約文に「\n」という文字列がそのまま出力されてしまうため、
    // 実際の改行コードに変換してから正規化する。
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000); // 要約用途なので長文は適度に切る
}

/** タイトル文字列の軽量サニタイズ（リテラル\nの除去・空白正規化のみ。HTMLタグ除去はstripHtmlほど積極的に行わない） */
function sanitizeTitle(title: string): string {
  return title.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

/** LLMに渡す用に、要約に必要な最小フィールドだけ抽出する（hash等は既読化済みなので不要） */
function toDigestInputStory(story: NewsblurStory) {
  return {
    title: sanitizeTitle(story.title),
    body: stripHtml(story.content),
    permalink: story.permalink,
  };
}

export async function runNewsblurDigest(ctx: AgentContext): Promise<string> {
  const skill = loadSkill('newsblur-digest');
  const today = new Date().toISOString().split('T')[0];

  // ─── Step 1: list_feeds をコード側から直接呼び、foldersの生データを取得 ───
  console.log('  📡 NewsBlur: list_feeds 取得中...');
  const rawListFeeds = await callMcpToolDirect(ctx, 'newsblur', 'list_feeds', { includeUnreadCounts: true });
  const listFeedsResult = parseMcpJson<{ feeds: unknown[]; folders: unknown }>(rawListFeeds, 'list_feeds結果');

  const folderMap = flattenNewsblurFolders(listFeedsResult.folders);
  console.log(`  📂 検出フォルダ: ${Object.keys(folderMap).join(', ') || '（なし）'}`);

  // ─── Step 2: 対象3フォルダのフィードIDを機械的に確定 ───
  // まず厳密なフォルダ名（skillに記載の固定名）で一致を試み、0件の場合のみ緩いパターンにフォールバックする。
  // 'AI'や'Tech'単独のような短い部分文字列を最初から使うと、無関係なフォルダ（例: 他のTech系フォルダ）を
  // 誤って巻き込むリスクがあるため、フォールバックは最終手段とする。
  function resolveFolder(strictNames: string[], looseNames: string[]): { matchedFolders: string[]; feedIds: number[] } {
    const strict = extractFeedIdsByFolderNames(folderMap, strictNames);
    if (strict.feedIds.length > 0) return strict;
    console.log(`  ℹ️  厳密一致（${strictNames.join('/')}）が0件のため、緩いパターンで再試行します`);
    return extractFeedIdsByFolderNames(folderMap, looseNames);
  }

  const musicFolders = resolveFolder(['音楽'], ['音楽']);
  const aiTechFolders = resolveFolder(['AI/Tech'], ['AI', 'Tech']);
  const bookFolders = resolveFolder(['読書/本/マンガ'], ['読書', '本', 'マンガ']);

  console.log(`  🎵 音楽フォルダ一致: ${musicFolders.matchedFolders.join(', ') || 'なし'}（${musicFolders.feedIds.length}フィード）`);
  console.log(`  🤖 AI/Techフォルダ一致: ${aiTechFolders.matchedFolders.join(', ') || 'なし'}（${aiTechFolders.feedIds.length}フィード）`);
  console.log(`  📖 読書/本/マンガフォルダ一致: ${bookFolders.matchedFolders.join(', ') || 'なし'}（${bookFolders.feedIds.length}フィード）`);

  if (musicFolders.feedIds.length === 0 && aiTechFolders.feedIds.length === 0 && bookFolders.feedIds.length === 0) {
    return `❌ 対象フォルダ（音楽/AI・Tech/読書・本・マンガ）が1件もフォルダ一覧から見つかりませんでした。\n` +
      `list_feedsのfolders生データ（先頭1000文字）:\n${rawListFeeds.slice(0, 1000)}\n\n` +
      `フォルダ名が変わっている可能性があります。skills/newsblur-digest.mdのフォルダ名指定を確認してください。`;
  }

  // ─── Step 3: 各フィードの未読記事を取得し、カテゴリ別に確定リストを作る ───
  async function fetchUnreadStories(feedId: number): Promise<NewsblurStory[]> {
    try {
      const raw = await callMcpToolDirect(ctx, 'newsblur', 'get_stories', {
        feedId,
        readFilter: 'unread',
        order: 'newest',
      });
      const parsed = parseMcpJson<{ stories: NewsblurStory[] }>(raw, `get_stories(feedId=${feedId})`);
      return parsed.stories ?? [];
    } catch (e) {
      console.log(`  ⚠️  feedId=${feedId} の取得失敗: ${(e as Error).message}`);
      return [];
    }
  }

  async function collectStories(feedIds: number[]): Promise<NewsblurStory[]> {
    const all: NewsblurStory[] = [];
    for (const feedId of feedIds) {
      const stories = await fetchUnreadStories(feedId);
      all.push(...stories);
    }
    return all;
  }

  console.log('  📰 未読記事を取得中...');
  const musicStories = await collectStories(musicFolders.feedIds);
  const aiTechStories = await collectStories(aiTechFolders.feedIds);
  const bookStoriesAll = await collectStories(bookFolders.feedIds);
  const bookStoriesFiltered = bookStoriesAll.filter(matchesYuriKeyword);

  console.log(`  ✅ 採用記事数: 音楽=${musicStories.length} / AI・Tech=${aiTechStories.length} / 百合マンガ=${bookStoriesFiltered.length}（読書フォルダ全${bookStoriesAll.length}件中）`);

  const adoptedStories = [...musicStories, ...aiTechStories, ...bookStoriesFiltered];

  if (adoptedStories.length === 0) {
    return `📭 本日（${today}）は対象フォルダに採用すべき未読記事がありませんでした。\n` +
      `（音楽=0件 / AI・Tech=0件 / 読書フォルダ${bookStoriesAll.length}件中、百合関連語ヒット0件）`;
  }

  // ─── Step 4: 要約・Markdown整形はLLMに委譲し、保存はコード側で直接ファイル書き込み ───
  // フィルタ判断は既に確定済みなので、LLMの役目は「Markdown文字列を生成して返すこと」だけ。
  //
  // 設計の経緯（旧Craft保存版で起きた事故）:
  // 当初は3カテゴリ・全71件を1回のrunAgent呼び出しに渡したところ、LLMが処理途中で
  // 「次にAI・Techセクションを追加します」という進捗報告のテキストだけを返してツール呼び出しを
  // ゼロ件にしたため、runAgentの終了条件（ツール呼び出しなし=完了とみなす）でループが打ち切られ、
  // 一部カテゴリが未保存のままmark_as_readが実行される事故が起きた。
  // その後、カテゴリ→チャンク単位への分割と完了マーカーによる検証で対処したが、今度は
  // (a) 完了マーカー文字列がCraft本文に誤って書き込まれる、(b) LLMがcraft_readでドキュメントを
  // 読み返した際に自分の既出内容を誤認し記事を重複して書き込む、という新たな事故が発生した。
  // これらはいずれも「LLMにツール呼び出しを介して外部に書き込ませる」という設計自体に起因する
  // 事故クラスだったため、Craft保存をやめてローカルMarkdownファイル保存に変更した。
  // ローカル保存ではLLMはMarkdown文字列を1回のテキスト応答として返すだけ（ツールなし）でよく、
  // 実際のファイル書き込みはコード側のfs.writeFileSyncが確定的に行うため、上記の事故クラスは
  // 構造上発生しなくなる。
  const noToolCtx: AgentContext = { ...ctx, mcpTools: [] };

  function formatCategorySection(def: { label: string; stories: NewsblurStory[] }): string {
    if (def.stories.length === 0) {
      return `## ${def.label}\n\n該当記事なし`;
    }
    const articlesJson = JSON.stringify(def.stories.map(toDigestInputStory), null, 2);
    return `## ${def.label}（${def.stories.length}件）\n\n記事リスト（JSON）:\n${articlesJson}`;
  }

  const categoryDefs = [
    { label: '🎵 音楽', stories: musicStories },
    { label: '🤖 AI・Tech', stories: aiTechStories },
    { label: '📖 百合マンガ', stories: bookStoriesFiltered },
  ];

  const digestPrompt = `以下はNewsBlurから既に取得・フィルタ済みの採用記事リストです（フィルタ判断は完了済みなので、ここから記事を増減させないでください。1件も省略しないでください）。
Skillの「Step 3: 要約」「Step 4: Markdown整形」の指示に従い、各記事を2〜3行で要約し、指定フォーマットのMarkdown全体を1つのテキストとして出力してください。
出力は最終的なMarkdown本文そのものだけにしてください（前置きの挨拶や説明、コードブロックの\`\`\`での囲みは不要です）。

収集日: ${today}

${categoryDefs.map(formatCategorySection).join('\n\n---\n\n')}`;

  console.log('  ✍️  要約・Markdown整形を実行中...');
  const digestMarkdown = await runAgent(digestPrompt, skill, noToolCtx, 10);

  // ─── Step 4b: ローカルファイルへの保存はコード側で確定的に実行 ───
  const digestDir = process.env.NEWSBLUR_DIGEST_DIR ?? path.join(process.env.HOME ?? '', 'newsblur-digest');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // 例: 2026-06-20T07-45-12-345Z（1日複数回実行に対応するため毎回別ファイル）
  const outPath = path.join(digestDir, `newsblur-digest-${timestamp}.md`);

  let saved = false;
  try {
    fs.mkdirSync(digestDir, { recursive: true });
    fs.writeFileSync(outPath, digestMarkdown, 'utf-8');
    saved = true;
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  if (!saved) {
    return `❌ Markdownの生成はできましたが、ファイル保存に失敗しました（保存先: ${outPath}）。\n` +
      `NewsBlur側の記事は未読のままなので、保存先のディレクトリ権限等を確認後、再実行すれば拾い直せます。\n\n` +
      `生成されたMarkdown（保存できなかった内容）:\n${digestMarkdown}`;
  }

  // ─── Step 5: ファイル保存が確認できたので、採用記事全件をコード側でループしながら既読化 ───
  console.log('  ✔️  既読化中...');
  let markedCount = 0;
  for (const story of adoptedStories) {
    try {
      await callMcpToolDirect(ctx, 'newsblur', 'mark_as_read', { storyHash: story.hash });
      markedCount++;
    } catch (e) {
      console.log(`  ⚠️  既読化失敗 (hash=${story.hash}): ${(e as Error).message}`);
    }
  }
  console.log(`  ✅ 既読化完了: ${markedCount}/${adoptedStories.length}件`);

  return `✅ NewsBlur要約をローカルファイルに保存しました\n\n📄 保存先: ${outPath}\n\n📊 内訳: 音楽${musicStories.length}件 / AI・Tech${aiTechStories.length}件 / 百合マンガ${bookStoriesFiltered.length}件（読書フォルダ全${bookStoriesAll.length}件中）\n✔️ 既読化: ${markedCount}/${adoptedStories.length}件`;
}

// ─── fact-checker ─────────────────────────────────────────────

export async function runFactChecker(ctx: AgentContext, input?: string): Promise<string> {
  const skill = loadSkill('fact-checker');
  const today = new Date().toISOString().split('T')[0];

  const targetPath = input
    ? resolvePath(input)
    : path.join(
        process.env.NOTE_DIR ?? path.join(process.env.HOME ?? '', 'Fujitsu_Chromebook', 'Output', 'note用'),
        `ai-news-${today}.md`
      );

  if (!fs.existsSync(targetPath)) {
    return `❌ ファイルが見つかりません: ${targetPath}\n   先に daily-ai-news を実行してください。`;
  }

  const content = fs.readFileSync(targetPath, 'utf-8');

  const prompt = `以下のAIニュース素材ファイルをファクトチェックしてください。
Skillの手順に従い、URLの存在確認と怪しい箇所の事実確認を行い、チェック結果セクションを出力してください。
出力はチェック結果セクションのMarkdownのみ返してください。

対象ファイル: ${targetPath}

---

${content}`;

  const result = await runAgent(prompt, skill, ctx);

  try {
    const updated = content
      .replace('ステータス: 収集済み（未チェック）', 'ステータス: チェック済み')
      + '\n' + result;
    fs.writeFileSync(targetPath, updated, 'utf-8');
    console.log(`  ✅ チェック結果を追記しました: ${targetPath}`);
  } catch (e) {
    console.log(`  ⚠️  ファイル更新失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 更新先: ${targetPath}`;
}

/** デフォルト期間: 今日〜2週間後 */
function getDefaultPeriod(): string {
  const today = new Date();
  const twoWeeksLater = new Date(today);
  twoWeeksLater.setDate(today.getDate() + 14);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return `${fmt(today)} ${fmt(twoWeeksLater)}`;
}

// ─── SEOレポート ─────────────────────────────────────────────

export interface SeoReportPeriod {
  targetStart: string;
  targetEnd: string;
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function calcComparePeriod(targetStart: string, targetEnd: string): {
  compareStart: string;
  compareEnd: string;
} {
  const start = new Date(targetStart);
  const end = new Date(targetEnd);
  const duration = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  const compareEnd = new Date(start);
  compareEnd.setDate(compareEnd.getDate() - 1);
  const compareStart = new Date(compareEnd);
  compareStart.setDate(compareStart.getDate() - (duration - 1));

  return { compareStart: fmtDate(compareStart), compareEnd: fmtDate(compareEnd) };
}

export function parseSeoReportPeriod(input: string): SeoReportPeriod | null {
  const trimmed = input.trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

  if (trimmed === '') {
    const start = new Date(yesterday);
    start.setDate(yesterday.getDate() - 6);
    return { targetStart: fmtDate(start), targetEnd: fmtDate(yesterday) };
  }
  if (/^先月$/.test(trimmed)) {
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { targetStart: fmtDate(start), targetEnd: fmtDate(end) };
  }
  if (/^先々月$/.test(trimmed)) {
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    const endOfMonthBefore = new Date(endOfLastMonth.getFullYear(), endOfLastMonth.getMonth(), 0);
    const start = new Date(endOfMonthBefore.getFullYear(), endOfMonthBefore.getMonth(), 1);
    return { targetStart: fmtDate(start), targetEnd: fmtDate(endOfMonthBefore) };
  }
  if (/^今月$/.test(trimmed)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { targetStart: fmtDate(start), targetEnd: fmtDate(yesterday) };
  }
  if (/^先週$/.test(trimmed)) {
    const day = today.getDay();
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - day - 6);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    return { targetStart: fmtDate(lastMonday), targetEnd: fmtDate(lastSunday) };
  }
  if (/^今週$/.test(trimmed)) {
    const day = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    return { targetStart: fmtDate(monday), targetEnd: fmtDate(yesterday) };
  }
  const recentDays = trimmed.match(/^過去(\d+)日$/);
  if (recentDays) {
    const n = parseInt(recentDays[1], 10);
    const start = new Date(yesterday);
    start.setDate(yesterday.getDate() - (n - 1));
    return { targetStart: fmtDate(start), targetEnd: fmtDate(yesterday) };
  }
  const monthOnly = trimmed.match(/^(?:(\d{4})年)?(\d{1,2})月$/);
  if (monthOnly) {
    const month = parseInt(monthOnly[2], 10) - 1;
    let year = monthOnly[1] ? parseInt(monthOnly[1], 10) : today.getFullYear();
    if (!monthOnly[1] && month > today.getMonth()) year -= 1;
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    const isCurrent = year === today.getFullYear() && month === today.getMonth();
    return { targetStart: fmtDate(start), targetEnd: isCurrent ? fmtDate(yesterday) : fmtDate(end) };
  }
  const normalized = trimmed
    .replace(/\//g, '-').replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '')
    .replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (_, y, m, d) =>
      `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  const parts = normalized.split(/[〜~\s]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 2 && isValidDate(parts[0]) && isValidDate(parts[1])) {
    return { targetStart: parts[0], targetEnd: parts[1] };
  }
  return null;
}

export async function runSeoReport(
  ctx: AgentContext,
  period: SeoReportPeriod
): Promise<string> {
  const { compareStart, compareEnd } = calcComparePeriod(period.targetStart, period.targetEnd);

  console.log(`\n📊 SEOレポート生成中...`);
  console.log(`  対象期間: ${period.targetStart} 〜 ${period.targetEnd}`);
  console.log(`  比較期間: ${compareStart} 〜 ${compareEnd}`);

  const skill = loadSkill('seo-weekly-report');

  const prompt = `以下の期間のSEOレポートを生成してください。

対象期間: ${period.targetStart} 〜 ${period.targetEnd}
比較期間: ${compareStart} 〜 ${compareEnd}

上記の期間でデータを取得し、Skillの手順に従ってレポートを生成してください。
ファイルへの保存は不要です。Markdownテキストをそのまま返してください。`;

  const result = await runAgent(prompt, skill, ctx, 30);
  console.log('  ✅ SEOレポート生成完了');
  return result;
}

// ─── youtube-summary ──────────────────────────────────────────

export async function runYoutubeSummary(
  ctx: AgentContext,
  input: string
): Promise<string> {
  const skill = loadSkill('youtube-summary');

  const parts = input.trim().split(/\s+/);
  const url = parts[0];
  const lang = parts[1] ?? 'en';

  if (!url || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(url)) {
    return '❌ YouTube URLを指定してください。\n   例: youtube-summary https://youtu.be/xxxxx [ja|en]';
  }

  const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) {
    return `❌ video IDを抽出できませんでした: ${url}`;
  }

  console.log(`  🎬 動画情報を取得中... (${videoId})`);

  let title = '(タイトル取得失敗)';
  let channel = '(チャンネル不明)';
  let duration = '(時間不明)';
  try {
    const { stdout: infoJson } = await execAsync(
      `yt-dlp --dump-single-json --skip-download --no-playlist "${url}"`,
      { timeout: 30_000 }
    );
    const info = JSON.parse(infoJson);
    title = info.title ?? title;
    channel = info.uploader ?? info.channel ?? channel;
    const sec = info.duration ?? 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    duration = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
    console.log(`  ✅ タイトル: ${title}`);
  } catch (e) {
    console.log(`  ⚠️  メタ情報取得失敗: ${(e as Error).message}`);
  }

  console.log(`  📝 字幕を取得中... (言語: ${lang})`);
  let captionText = '';
  let usedLang = lang;
  const tempBase = `/tmp/ytsub-${videoId}-${Date.now()}`;

  try {
    const subArgs = [
      `--write-subs --write-auto-subs`,
      `--sub-langs "${lang}"`,
      `--sub-format vtt`,
      `--skip-download`,
      `--no-playlist`,
      `-o "${tempBase}.%(ext)s"`,
      `"${url}"`,
    ].join(' ');

    await execAsync(`yt-dlp ${subArgs}`, { timeout: 60_000 });

    const { stdout: found } = await execAsync(
      `ls ${tempBase}*.vtt 2>/dev/null | head -1 || echo ""`
    );
    const vttPath = found.trim();

    if (!vttPath) {
      const { stdout: subList } = await execAsync(
        `yt-dlp --list-subs --skip-download --no-playlist "${url}" 2>/dev/null | head -30 || echo ""`
      );
      return `❌ 字幕が見つかりませんでした（言語: ${lang}）\n\n利用可能な字幕:\n${subList || '（なし）'}\n\n言語コードを指定して再実行してください。\n例: youtube-summary ${url} ja`;
    }

    const langMatch = vttPath.match(/\.([a-zA-Z-]+)\.vtt$/);
    if (langMatch) usedLang = langMatch[1];

    const { stdout: vttContent } = await execAsync(`cat "${vttPath}"`);
    await execAsync(`rm -f ${tempBase}*.vtt 2>/dev/null || true`);

    const lines = vttContent.split('\n');
    const textLines: string[] = [];
    let prevLine = '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        !trimmedLine ||
        trimmedLine.startsWith('WEBVTT') ||
        trimmedLine.startsWith('Kind:') ||
        trimmedLine.startsWith('Language:') ||
        trimmedLine.includes('-->')
      ) continue;

      const clean = trimmedLine.replace(/<[^>]*>/g, '').trim();
      if (clean && clean !== prevLine) {
        textLines.push(clean);
        prevLine = clean;
      }
    }

    captionText = textLines.join(' ');
    console.log(`  ✅ 字幕取得完了 (${captionText.length}文字, 言語: ${usedLang})`);

  } catch (e) {
    await execAsync(`rm -f ${tempBase}*.vtt 2>/dev/null || true`);
    return `❌ 字幕取得に失敗しました: ${(e as Error).message}`;
  }

  if (!captionText.trim()) {
    return `❌ 字幕テキストが空でした。字幕のない動画か、取得に失敗しました。`;
  }

  const MAX_CHARS = 60_000;
  let captionInput = captionText;
  let truncated = false;
  if (captionText.length > MAX_CHARS) {
    captionInput = captionText.slice(0, MAX_CHARS);
    truncated = true;
    console.log(`  ⚠️  字幕が長いため先頭${MAX_CHARS}文字に切り詰めました`);
  }

  console.log('  🤖 要約を生成中...');
  const prompt = `以下のYouTube動画の字幕テキストを要約してください。

## 動画情報
- タイトル: ${title}
- チャンネル: ${channel}
- 時間: ${duration}
- URL: https://www.youtube.com/watch?v=${videoId}
- 字幕言語: ${usedLang}
${truncated ? '- ※字幕が長いため先頭部分のみ使用しています\n' : ''}
## 字幕テキスト

${captionInput}`;

  const summaryCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, summaryCtx);

  const today = new Date().toISOString().split('T')[0];
  const safeTitle = title.replace(/[<>:"/\\|?*\s]/g, '_').slice(0, 40);
  const outDir = process.env.YOUTUBE_SUMMARY_DIR ?? '/home/takaonaga/Documents/Fujitsu_Chromebook/workspace/Output/youtube-summary';
  const outPath = path.join(outDir, `youtube-summary-${safeTitle}-${today}.md`);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, result, 'utf-8');
    console.log(`  ✅ 保存しました: ${outPath}`);
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
  }

  return `${result}\n\n---\n📄 保存先: ${outPath}`;
}

// ─── booklist-update ──────────────────────────────────────────

export async function runBooklistUpdate(ctx: AgentContext, input: string): Promise<string> {
  const skill = loadSkill('booklist-update');

  const listPath = path.join(
    process.env.HOME ?? '',
    'Documents',
    'Fujitsu_Chromebook',
    'workspace',
    'masterlist',
    'yuri-manga-list.md'
  );

  if (!fs.existsSync(listPath)) {
    return `❌ 蔵書リストが見つかりません: ${listPath}`;
  }

  const currentList = fs.readFileSync(listPath, 'utf-8');
  const resolved = resolveInput(input);

  const prompt = `以下の現在の蔵書リストに対して、ユーザーの入力内容を反映してください。

## 現在の蔵書リスト
${currentList}

## ユーザーの入力
${resolved}

Skillの手順に従って処理し、更新後の蔵書リストの全文をMarkdownで出力してください。`;

  const updateCtx = { ...ctx, mcpTools: [] };
  const result = await runAgent(prompt, skill, updateCtx);

  try {
    fs.writeFileSync(listPath, result, 'utf-8');
    console.log(`  ✅ 蔵書リストを更新しました: ${listPath}`);
  } catch (e) {
    return `❌ ファイル保存に失敗しました: ${(e as Error).message}\n\n--- 更新後の内容 ---\n${result}`;
  }

  return `✅ 蔵書リストを更新しました: ${listPath}\n\n---\n${result.slice(0, 500)}...`;
}

// ─── フリーチャット ────────────────────────────────────────────

import { HistoryEntry } from '../agent.js';

export async function runFreeChat(
  ctx: AgentContext,
  userInput: string,
  history: HistoryEntry[]
): Promise<string> {
  const memoryPrompt: string = (ctx as any)._memoryPrompt ?? '';
  const systemPrompt = `あなたはLinhuaFamiliarです。百合マンガブログ「琳花の百合漫画語り部屋」の運営をサポートするエージェントです。
ブログ作業の壁打ち・文章の手直し・質問への回答など、タスク実行以外の会話を自然に行ってください。
CraftやWeb検索など利用可能なツールがあれば積極的に活用してください。${memoryPrompt}`;

  const recentHistory = history
    .slice(-20)
    .filter(h => h.role === 'user')
    .slice(-10)
    .map(h => h.content.slice(0, 500))
    .join('\n---\n');

  const prompt = recentHistory
    ? `【直近の会話履歴（参考）】\n${recentHistory}\n\n【今回の入力】\n${userInput}`
    : userInput;

  return runAgent(prompt, systemPrompt, ctx);
}

// ─── browser-fetch（playwright-cliでページからog:imageを取得） ─

export async function runBrowserFetch(input: string): Promise<string> {
  const url = input.trim();
  if (!url.startsWith('http')) {
    return '❌ URLを指定してください。例: browser-fetch https://...';
  }

  console.log(`  🌐 ブラウザでアクセス中... ${url}`);

  try {
    await execAsync(`playwright-cli open "${url}"`, { timeout: 30_000 });

    const { stdout } = await execAsync(
      `playwright-cli eval "document.querySelector('meta[property=\\"og:image\\"]')?.content ?? ''"`,
      { timeout: 10_000 }
    );

    await execAsync('playwright-cli close').catch(() => {});

    const imageUrl = stdout.trim();
    if (!imageUrl) {
      return '❌ og:imageが見つかりませんでした（ページにog:imageメタタグがない可能性があります）';
    }

    console.log(`  ✅ 画像URL取得: ${imageUrl}`);
    return imageUrl;

  } catch (e) {
    await execAsync('playwright-cli close').catch(() => {});
    return `❌ ブラウザ取得失敗: ${(e as Error).message}`;
  }
}

// ─── browser（自然言語でplawright-cli操作） ───────────────────

const BROWSER_PLAN_PROMPT = `あなたはPlaywright CLIを使ってブラウザ操作を行うアシスタントです。
ユーザーの指示を解釈し、playwright-cliコマンド列をJSON配列で返してください。

利用可能なコマンド例:
- "open <url>"                    → ページを開く
- "eval <js式>"                   → JavaScript評価（値を取得する場合）
- "screenshot"                    → スクリーンショット（--filename=で保存先指定可）
- "screenshot --filename=<path>"  → 指定パスに保存
- "snapshot"                      → ページ構造を取得（要素を探す場合）
- "close"                         → ブラウザを閉じる

出力形式（JSONのみ・他のテキスト不要）:
["open https://example.com", "eval document.querySelector('meta[property=\"og:image\"]')?.content ?? ''", "close"]

注意:
- 最後は必ず "close" を含めること
- 値を取得する操作は "eval ..." を使う
- スクリーンショット保存先は ~/images/ 以下を使う（パス省略時はこのディレクトリ）
- ページ読み込み待機は "open" が自動で行うため不要`;

const BROWSER_SUMMARY_PROMPT = `あなたはブラウザ操作の結果を分かりやすく伝えるアシスタントです。
ユーザーの指示と実行結果をもとに、結果を簡潔に日本語で説明してください。
取得できたURLや値は必ず含めてください。`;

export async function runBrowser(ctx: AgentContext, input: string): Promise<string> {
  if (!input.trim()) {
    return '❌ 操作内容を指定してください。例: browser https://... のog:imageを取って';
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const model = process.env.MODEL_CHAT ?? ctx.model;

  console.log('  🤖 操作プランを生成中...');
  let commands: string[] = [];
  try {
    const planRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://linhua-blog.com',
        'X-Title': 'LinhuaFamiliar',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: BROWSER_PLAN_PROMPT },
          { role: 'user', content: input },
        ],
        max_tokens: 500,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const planData = await planRes.json() as { choices: Array<{ message: { content: string } }> };
    const raw = planData.choices[0]?.message?.content ?? '[]';
    const cleaned = raw.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    commands = JSON.parse(cleaned) as string[];
    console.log(`  📋 プラン: ${commands.join(' → ')}`);
  } catch (e) {
    return `❌ 操作プランの生成に失敗しました: ${(e as Error).message}`;
  }

  if (commands.length === 0) {
    return '❌ 実行できるコマンドが生成されませんでした';
  }

  const results: Array<{ cmd: string; output: string; ok: boolean }> = [];
  for (const cmd of commands) {
    console.log(`  ▶ playwright-cli ${cmd}`);
    try {
      const { stdout, stderr } = await execAsync(
        `playwright-cli ${cmd}`,
        { timeout: 30_000 }
      );
      const output = (stdout + stderr).trim();
      results.push({ cmd, output, ok: true });
      if (output) console.log(`    → ${output.slice(0, 100)}`);
    } catch (e) {
      const msg = (e as Error).message;
      results.push({ cmd, output: msg, ok: false });
      console.warn(`  ⚠️  失敗: ${msg.slice(0, 80)}`);
      if (cmd.startsWith('open ')) {
        await execAsync('playwright-cli close').catch(() => {});
        return `❌ ページを開けませんでした: ${msg}`;
      }
    }
  }

  const resultSummary = results
    .map(r => `[${r.ok ? '✅' : '❌'}] playwright-cli ${r.cmd}\n${r.output}`)
    .join('\n\n');

  const summaryRes = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ctx.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://linhua-blog.com',
      'X-Title': 'LinhuaFamiliar',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: BROWSER_SUMMARY_PROMPT },
        { role: 'user', content: `指示: ${input}\n\n実行結果:\n${resultSummary}` },
      ],
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const summaryData = await summaryRes.json() as { choices: Array<{ message: { content: string } }> };
  return summaryData.choices[0]?.message?.content ?? resultSummary;
}

// ─── cover-from-asin（Amazon curl でog:imageを取得） ──────────

/** 取得した画像URLをローカルに保存して結果を返す */
async function saveCoverImage(imageUrl: string, asin: string): Promise<string> {
  const outDir = process.env.COVER_DIR ?? path.join(process.env.HOME ?? '', 'blog', 'covers');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const ext = imageUrl.endsWith('.webp') ? 'webp' : 'jpg';
    const outPath = path.join(outDir, `${asin}.${ext}`);
    await execAsync(`curl -sL "${imageUrl}" -o "${outPath}"`, { timeout: 15_000 });
    console.log(`  ✅ 保存しました: ${outPath}`);
    return `${imageUrl}\n📄 保存先: ${outPath}`;
  } catch (e) {
    console.log(`  ⚠️  保存失敗: ${(e as Error).message}`);
    return imageUrl; // 保存失敗してもURLは返す
  }
}

export async function runCoverFromAsin(asin: string): Promise<string> {
  const trimmed = asin.trim();
  if (!trimmed || !/^[A-Z0-9]{10}$/i.test(trimmed)) {
    return '❌ 有効なASIN（10文字英数字）を指定してください。例: cover-from-asin B0XXXXXXXX';
  }

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  console.log(`  📦 Amazon curl でASIN ${trimmed} の表紙画像を取得中...`);

  // 方法1: AmazonページのOG画像
  try {
    const { stdout } = await execAsync(
      `curl -s -L -H "User-Agent: ${ua}" -H "Accept-Language: ja-JP,ja;q=0.9" "https://www.amazon.co.jp/dp/${trimmed}" | grep -oP 'property="og:image"[^>]*content="\\K[^"]+'`,
      { timeout: 15_000 }
    );
    const imageUrl = stdout.trim();
    if (imageUrl && imageUrl.startsWith('http')) {
      console.log(`  ✅ 取得成功（方法1）: ${imageUrl}`);
      return saveCoverImage(imageUrl, trimmed);
    }
  } catch (e) {
    console.log(`  ⚠️  方法1失敗: ${(e as Error).message}`);
  }

  // 方法2: 検索結果ページ（m.media-amazon.com）
  try {
    const { stdout } = await execAsync(
      `curl -s -L -H "User-Agent: ${ua}" "https://www.amazon.co.jp/s?k=${trimmed}&i=digital-text" | grep -oP 'https://m\\.media-amazon\\.com/images/I/[A-Za-z0-9+._-]+\\.jpg' | head -1`,
      { timeout: 15_000 }
    );
    const imageUrl = stdout.trim();
    if (imageUrl && imageUrl.startsWith('http')) {
      console.log(`  ✅ 取得成功（方法2）: ${imageUrl}`);
      return saveCoverImage(imageUrl, trimmed);
    }
  } catch (e) {
    console.log(`  ⚠️  方法2失敗: ${(e as Error).message}`);
  }

  return '❌ Amazon curlで画像を取得できませんでした';
}
