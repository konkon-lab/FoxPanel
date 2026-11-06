// 阿里云百炼 Qwen-MT 翻译(OpenAI 兼容接口)：一句文字 → 目标语言。源语言自动识别。

import { isObject } from '../_shared/util.ts';

const TIMEOUT_MS = 15000;   // 一次翻译请求最多等这么久(毫秒)

export interface TranslateRequest {
  url: string;
  model: string;
  target: string;   // 目标语言的英文名，如 Japanese
  text: string;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

// 请求体：仅含一条 user 消息，语种放在 translation_options
export function translateBody(req: Omit<TranslateRequest, 'url'>): string {
  return JSON.stringify({
    model: req.model,
    messages: [{ role: 'user', content: req.text }],
    translation_options: { source_lang: 'auto', target_lang: req.target },
  });
}

// 响应体 → 对象；不是 JSON 对象时为 null
function parseResponse(body: string): ChatResponse | null {
  try {
    const r: unknown = JSON.parse(body);
    return isObject(r) ? r as ChatResponse : null;
  } catch {
    return null;
  }
}

// 从响应里取译文；无译文时抛出包含原因的 Error
export function extractTranslation(body: string): string {
  const r = parseResponse(body);
  if (!r) throw new Error(`翻译响应不是 JSON：${body.slice(0, 200)}`);
  const content: unknown = r.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (text) return text;
  throw new Error(`翻译失败：${r.error?.message ?? r.error?.code ?? body.slice(0, 200)}`);
}

const tokens = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// 响应里的 Token 用量(缺失时为 0)
export function extractUsage(body: string): { input: number; output: number } {
  const u = parseResponse(body)?.usage;
  return { input: tokens(u?.prompt_tokens), output: tokens(u?.completion_tokens) };
}

export async function translate(apiKey: string, req: TranslateRequest): Promise<{ text: string; input: number; output: number }> {
  const res = await fetch(req.url, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: translateBody(req),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`翻译请求被拒绝 ${res.status}：${body.slice(0, 300)}`);
  return { text: extractTranslation(body), ...extractUsage(body) };
}
