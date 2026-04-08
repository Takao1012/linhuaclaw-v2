import { AgentContext, runAgent } from '../agent.js';
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
  const result = await runAgent(
    `今週（${weekLabel}週）の百合漫画ニュースを収集して要約してください。`,
    skill,
    ctx
  );
  console.log('  ✅ ニュース収集完了');
  return result;
}

// SNSトレンド収集
export async function runTrend(ctx: AgentContext): Promise<string> {
  console.log('\n🐦 SNSトレンド収集中...');
  const skill = loadSkill('trend');
  const weekLabel = getWeekLabel();
  const result = await runAgent(
    `今週（${weekLabel}週）の百合漫画SNSトレンドを収集して要約してください。`,
    skill,
    ctx
  );
  console.log('  ✅ トレンド収集完了');
  return result;
}

// 週次まとめ（全タスク実行）
export async function runWeekly(ctx: AgentContext): Promise<{
  news: string;
  trend: string;
  sale: string;
  ranking: string;
  yurinaviNews: string;
}> {
  const news = await runNews(ctx);
  await sleep(3000);
  const trend = await runTrend(ctx);
  await sleep(3000);
  const sale = await runSale(ctx);
  await sleep(3000);
  const ranking = await runRanking(ctx);
  await sleep(3000);
  const yurinaviNews = await runYurinaviNews(ctx);
  return { news, trend, sale, ranking, yurinaviNews };
}

// セール情報収集
export async function runSale(ctx: AgentContext): Promise<string> {
  console.log('\n💰 セール情報収集中...');
  const skill = loadSkill('sale');
  const today = new Date().toISOString().split('T')[0];
  const result = await runAgent(
    `現在（${today}時点）の百合漫画セール情報を収集して要約してください。`,
    skill,
    ctx
  );
  console.log('  ✅ セール情報収集完了');
  return result;
}

// ランキング収集
export async function runRanking(ctx: AgentContext): Promise<string> {
  console.log('\n📊 ランキング収集中...');
  const skill = loadSkill('ranking');
  const today = new Date().toISOString().split('T')[0];
  const result = await runAgent(
    `現在（${today}時点）のpixivコミックとComicWalkerの百合ランキングを収集して要約してください。`,
    skill,
    ctx
  );
  console.log('  ✅ ランキング収集完了');
  return result;
}

// 百合ナビニュース一覧収集
export async function runYurinaviNews(ctx: AgentContext): Promise<string> {
  console.log('\n🔔 百合ナビニュース収集中...');
  const skill = loadSkill('yurinavi-news');
  const weekLabel = getWeekLabel();
  const result = await runAgent(
    `今週（${weekLabel}週）の百合ナビニュース一覧を収集して要約してください。`,
    skill,
    ctx
  );
  console.log('  ✅ 百合ナビニュース収集完了');
  return result;
}

// デイリーキャッチアップ
export async function runDaily(ctx: AgentContext): Promise<string> {
  console.log('\n🌙 デイリーキャッチアップ収集中...');
  const skill = loadSkill('daily');
  const today = new Date().toISOString().split('T')[0];
  const result = await runAgent(
    `今日（${today}）の百合漫画デイリーキャッチアップを収集して要約してください。`,
    skill,
    ctx
  );
  console.log('  ✅ デイリーキャッチアップ完了');
  return result;
}
