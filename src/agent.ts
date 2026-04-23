import fetch from 'node-fetch';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'fs';
import path from 'path';

// ─── 型定義 ───────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface McpServerConfig {
  // stdio型
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // SSE/HTTP型
  url?: string;
  disabled?: boolean;
}

export interface AgentContext {
  apiKey: string;
  model: string;
  mcpClients: Map<string, Client>;
  mcpTools: McpTool[];
}

interface McpTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

// ─── MCPクライアント初期化 ────────────────────────

export async function initMcp(mcpConfigPath: string): Promise<{
  clients: Map<string, Client>;
  tools: McpTool[];
}> {
  const clients = new Map<string, Client>();
  const tools: McpTool[] = [];

  if (!fs.existsSync(mcpConfigPath)) {
    console.log(`⚠️  .mcp.json が見つかりません: ${mcpConfigPath}`);
    return { clients, tools };
  }

  const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8')) as {
    mcpServers: Record<string, McpServerConfig>;
  };

  console.log('📡 MCPサーバー接続中...');

  for (const [name, serverConfig] of Object.entries(config.mcpServers ?? {})) {
    if (serverConfig.disabled) continue;
    try {
      // SSE/HTTP型（urlが設定されている場合）
      const transport = serverConfig.url
        ? new StreamableHTTPClientTransport(new URL(serverConfig.url))
        : new StdioClientTransport({
            command: serverConfig.command!,
            args: serverConfig.args ?? [],
            env: { ...process.env as Record<string, string>, ...(serverConfig.env ?? {}) },
          });
      const client = new Client({ name: 'linhua-claw-v2', version: '2.0.0' }, { capabilities: {} });
      await client.connect(transport);
      const { tools: serverTools } = await client.listTools();
      for (const tool of serverTools) {
        tools.push({
          serverName: name,
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      clients.set(name, client);
      console.log(`  ✅ ${name}: ${serverTools.length}ツール`);
    } catch (e) {
      console.log(`  ❌ ${name}: ${(e as Error).message}`);
    }
  }

  console.log(`  ✅ 合計 ${tools.length}ツール\n`);
  return { clients, tools };
}

export async function closeMcp(ctx: AgentContext): Promise<void> {
  for (const client of ctx.mcpClients.values()) {
    try { await client.close(); } catch {}
  }
}

// ─── MCP ツール実行 ───────────────────────────────

async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext
): Promise<string> {
  const tool = ctx.mcpTools.find(t => `mcp__${t.serverName}__${t.name}` === name);
  if (!tool) throw new Error(`MCPツールが見つかりません: ${name}`);

  const client = ctx.mcpClients.get(tool.serverName);
  if (!client) throw new Error(`MCPクライアントが未接続: ${tool.serverName}`);

  const result = await client.callTool({ name: tool.name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
}

// ─── LLM呼び出し ─────────────────────────────────

async function callLlm(
  messages: Message[],
  systemPrompt: string,
  model: string,
  apiKey: string,
  tools: McpTool[]
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const toolDefs = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: `mcp__${t.serverName}__${t.name}`,
      description: `[${t.serverName}] ${t.description}`,
      parameters: t.inputSchema,
    },
  }));

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  };
  if (toolDefs.length > 0) {
    body.tools = toolDefs;
    body.tool_choice = 'auto';
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://linhua-blog.com',
      'X-Title': 'LinhuaClaw v2',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status} ${await res.text()}`);

  const data = await res.json() as {
    choices: Array<{
      message: { content: string | null; tool_calls?: ToolCall[] };
    }>;
  };

  const choice = data.choices[0];
  return {
    content: choice.message.content,
    toolCalls: choice.message.tool_calls ?? [],
  };
}

// ─── 中間思考フィルタリング ──────────────────────

function filterThinking(text: string): string {
  return text
    // 「---\n次に〜」のような作業ログブロックを削除
    .replace(/\n*---+\n+(?:次に|では|続いて|それでは|まず)[^\n]*\n*/g, '\n')
    // 「次に〜しましょう」「〜を取得します」単独行を削除
    .replace(/^(?:次に|では次に|続いて|それでは|まず)[^\n]*\n/gm, '')
    // 先頭・末尾の余分な改行を整理
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── エージェントループ ───────────────────────────

export async function runAgent(
  userPrompt: string,
  systemPrompt: string,
  ctx: AgentContext,
  maxTurns = 20
): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: userPrompt }];

  for (let turn = 0; turn < maxTurns; turn++) {
    console.log(`  🔄 turn ${turn + 1}/${maxTurns}`);

    const { content, toolCalls } = await callLlm(
      messages,
      systemPrompt,
      ctx.model,
      ctx.apiKey,
      ctx.mcpTools
    );

    if (toolCalls.length === 0) {
      return filterThinking(content ?? '（応答なし）');
    }

    messages.push({ role: 'assistant', content: content || 'Calling tools...' });

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      console.log(`  🔧 ${tc.function.name}`);
      let result: string;
      try {
        result = await callMcpTool(tc.function.name, args, ctx);
      } catch (e) {
        result = `エラー: ${(e as Error).message}`;
        console.log(`  ⚠️  ${result}`);
      }
      messages.push({ role: 'user', content: `Tool result:\n${result.slice(0, 8000)}` });
    }
  }

  throw new Error(`${maxTurns}ターン以内に完了しませんでした`);
}
