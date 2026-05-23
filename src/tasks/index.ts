import { AgentContext, runAgent } from '../agent.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const SKILLS_DIR = path.join(process.cwd(), 'skills');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadSkill(name: string): string {
  return fs.readFileSync(path.join(SKILLS_DIR, `${name}.md`), 'utf-8');
}

function getWeekLabel(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// 百合漫画ニュース収集
export async function runNews(ctx: AgentContext): Promise<string> {
  console.log('\n📰 百合漫画ニュース収集中...');
  const skill = loadSkill('news');
  const weekLabel = getWeekLabel();
  const taskCtx = { ...ctx, model: process.env.MODEL_WEEKLY ?? ctx.model };
  const result = await runAgent(
    `今週（${weekLabel}週）の百合漫画ニュースを収集して要約してください。`,
    skill,
    taskCtx
  );
  console.log('  ✅ ニュース収集完了');
  return result;
}

// SNSトレンド収集
export async function runTrend(ctx: AgentContext): Promise<string> {
  console.log('\n🐦 SNSトレンド収集中...');
  const skill = loadSkill('trend');
  const weekLabel = getWeekLabel();
  const taskCtx = { ...ctx, model: process.env.MODEL_WEEKLY ?? ctx.model };
  const result = await runAgent(
    `今週（${weekLabel}週）の百合漫画SNSトレンドを収集して要約してください。`,
    skill,
    taskCtx
  );
  console.log('  ✅ トレンド収集完了');
  return result;
}

// タスクを安全に実行（失敗してもスキップして続行）
async function safeRun(
  name: string,
  fn: () => Promise<string>
): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    const msg = `⚠️ ${name}の収集に失敗しました: ${(e as Error).message}`;
    console.error(`  ❌ ${msg}`);
    return msg;
  }
}

// 週次まとめ（全タスク実行・途中でコケても続行）
export async function runWeekly(ctx: AgentContext): Promise<{
  news: string;
  trend: string;
  sale: string;
  yurinaviNews: string;
}> {
  const news = await safeRun('ニュース', () => runNews(ctx));
  await sleep(3000);
  const trend = await safeRun('トレンド', () => runTrend(ctx));
  await sleep(3000);
  const sale = await safeRun('セール情報', () => runSale(ctx));
  await sleep(3000);
  const yurinaviNews = await safeRun('百合ナビニュース', () => runYurinaviNews(ctx));
  return { news, trend, sale, yurinaviNews };
}

// セール情報収集
export async function runSale(ctx: AgentContext): Promise<string> {
  console.log('\n💰 セール情報収集中...');
  const skill = loadSkill('sale');
  const today = new Date().toISOString().split('T')[0];
  const taskCtx = { ...ctx, model: process.env.MODEL_WEEKLY ?? ctx.model };
  const result = await runAgent(
    `現在（${today}時点）の百合漫画セール情報を収集して要約してください。`,
    skill,
    taskCtx
  );
  console.log('  ✅ セール情報収集完了');
  return result;
}

// ランキング収集
export async function runRanking(ctx: AgentContext): Promise<string> {
  console.log('\n📊 ランキング収集中...');
  const skill = loadSkill('ranking');
  const today = new Date().toISOString().split('T')[0];
  const taskCtx = { ...ctx, model: process.env.MODEL_RANKING ?? ctx.model };
  const result = await runAgent(
    `現在（${today}時点）のpixivコミックとComicWalkerの百合ランキングを収集して要約してください。`,
    skill,
    taskCtx
  );
  console.log('  ✅ ランキング収集完了');
  return result;
}

// 百合ナビニュース一覧収集
export async function runYurinaviNews(ctx: AgentContext): Promise<string> {
  console.log('\n🔔 百合ナビニュース収集中...');
  const skill = loadSkill('yurinavi-news');
  const weekLabel = getWeekLabel();
  const taskCtx = { ...ctx, model: process.env.MODEL_WEEKLY ?? ctx.model };
  const result = await runAgent(
    `今週（${weekLabel}週）の百合ナビニュース一覧を収集して要約してください。`,
    skill,
    taskCtx
  );
  console.log('  ✅ 百合ナビニュース収集完了');
  return result;
}

// KUキャッチアップ
export async function runKuCatchup(ctx: AgentContext): Promise<string> {
  console.log('\n📚 KUキャッチアップ収集中...');
  const skill = loadSkill('ku-catchup');
  const today = new Date().toISOString().split('T')[0];
  const taskCtx = { ...ctx, model: process.env.MODEL_KU ?? process.env.MODEL_TASK ?? ctx.model };
  const result = await runAgent(
    `今日（${today}）のKUキャッチアップを実行してください。クエリ: 百合漫画, 百合マンガ, 百合, 百合 コミック`,
    skill,
    taskCtx
  );
  console.log('  ✅ KUキャッチアップ完了');
  return result;
}

// デイリーキャッチアップ
export async function runDaily(ctx: AgentContext): Promise<string> {
  console.log('\n🌙 デイリーキャッチアップ収集中...');
  const skill = loadSkill('daily');
  const today = new Date().toISOString().split('T')[0];
  const taskCtx = { ...ctx, model: process.env.MODEL_DAILY ?? ctx.model };
  const result = await runAgent(
    `今日（${today}）の百合漫画デイリーキャッチアップを収集して要約してください。`,
    skill,
    taskCtx
  );
  console.log('  ✅ デイリーキャッチアップ完了');
  return result;
}

// 新刊リスト取得
export async function runShinkan(ctx: AgentContext): Promise<string> {
  console.log('\n📚 新刊リスト取得中...');
  const skill = loadSkill('shinkan');
  const today = new Date().toISOString().split('T')[0];
  const taskCtx = { ...ctx, model: process.env.MODEL_SHINKAN ?? process.env.MODEL_WEEKLY ?? ctx.model };

  // カレンダーページを事前fetchしてプロンプトに埋め込む
  console.log('  📡 百合ナビカレンダーを取得中...');
  let calendarMarkdown = '';
  try {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY が未設定');
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://yurinavi.com/yuri-calendar/', formats: ['markdown'] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Firecrawl API error: ${res.status}`);
    const data = await res.json() as { data?: { markdown?: string } };
    calendarMarkdown = data.data?.markdown ?? '';
    console.log(`  ✅ カレンダー取得完了 (${calendarMarkdown.length}文字)`);
  } catch (e) {
    console.log(`  ⚠️  カレンダー取得失敗: ${(e as Error).message}`);
  }

  const prompt = calendarMarkdown
    ? `以下は百合ナビのカレンダーページの内容です。現在（${today}時点）の今週・来週・再来週の新刊リストを抽出して整形してください。\n\n---\n${calendarMarkdown}\n---`
    : `現在（${today}時点）の百合漫画新刊リストを取得して整形してください。`;

  // firecrawl_scrapeのみに絞ったctxを渡す
  const shinkanCtx = {
    ...taskCtx,
    mcpTools: taskCtx.mcpTools.filter((t: any) => t.name === 'firecrawl_scrape'),
  };
  const result = await runAgent(prompt, skill, shinkanCtx);
  console.log('  ✅ 新刊リスト取得完了');
  return result;
}
