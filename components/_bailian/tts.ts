// 阿里云百炼 CosyVoice 流式合成(SSE)：一句文字 → 一段 mp3。

import { isObject } from '../_shared/util.ts';

const STALL_MS = 15000;            // 超过此时间(毫秒)未收到数据视为超时
const MP3_SAMPLE_RATE = 24000;     // 合成的 mp3 的采样率(Hz)
export const TTS_MAX_CHARS = 500;  // 一句最多合成的字数

export interface TtsRequest {
  url: string;
  model: string;
  voice: string;
  text: string;
}

// 一个 SSE 事件的解析结果
export type TtsFrame =
  | { kind: 'audio'; data: string }   // base64 mp3 片段
  | { kind: 'done' }
  | { kind: 'usage'; characters: number }   // 计费字符(累计)
  | { kind: 'error'; message: string };

interface DashScopeFrame {
  code?: string;
  message?: string;
  output?: { audio?: { data?: string }; finish_reason?: string };
  usage?: { characters?: number };
}

// SSE 分事件：一个事件可能有多行 data:(有的模型把 JSON 分行发)，用换行拼起来，空行结束一个事件
export class SseReader {
  private buffer = '';
  private data: string[] = [];

  // 喂一段文字，返回其中已结束的事件的 data
  push(text: string): string[] {
    this.buffer += text;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    const out: string[] = [];
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line) {
        if (this.data.length) out.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(line[5] === ' ' ? 6 : 5));
      }
    }
    return out;
  }

  // 流结束：交出最后一个没以空行结束的事件
  end(): string[] {
    return this.push('\n\n');
  }
}

// 解析一个事件的 data；音频和结束标记可能位于同一帧，所以返回列表
export function parseTtsEvent(json: string): TtsFrame[] {
  let f: DashScopeFrame;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isObject(parsed)) return [];
    f = parsed as DashScopeFrame;
  } catch {
    return [];
  }
  if (f.code || f.message) return [{ kind: 'error', message: [f.code, f.message].filter(Boolean).join(' ') }];
  const out: TtsFrame[] = [];
  const data = f.output?.audio?.data;
  if (typeof data === 'string' && data) out.push({ kind: 'audio', data });
  if (typeof f.usage?.characters === 'number') out.push({ kind: 'usage', characters: f.usage.characters });
  if (f.output?.finish_reason === 'stop') out.push({ kind: 'done' });
  return out;
}

// 自定义音色(复刻音色等)；model 非空时固定用这个模型合成
export interface CustomVoice {
  name: string;
  id: string;
  model: string;
}

// 当前音色是绑定了模型的自定义音色时用它的模型，否则用设置里的模型
export function modelFor(s: { model: string; voice: string; customVoices: readonly CustomVoice[] }): string {
  return s.customVoices.find(v => v.id === s.voice && v.model)?.model ?? s.model;
}

// 合成一句，返回完整 mp3 和计费字符(接口未返回时按字数计算)；失败抛出带原因的 Error
export async function synthesize(apiKey: string, req: TtsRequest): Promise<{ mp3: Buffer; characters: number }> {
  const ctrl = new AbortController();
  let stalled = false;
  const arm = (): NodeJS.Timeout => setTimeout(() => { stalled = true; ctrl.abort(); }, STALL_MS);
  let timer = arm();
  // 收到数据时重新计时
  const touch = (): void => {
    clearTimeout(timer);
    timer = arm();
  };
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify({
        model: req.model,
        input: { text: req.text, voice: req.voice, format: 'mp3', sample_rate: MP3_SAMPLE_RATE },
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      // 418：音色不属于这个模型(系统音色和模型对不上，或复刻音色绑的模型不对)
      if (body.includes('error code: 418')) throw new Error(`合成请求被拒绝：音色 ${req.voice} 不能用于 ${req.model}`);
      throw new Error(`合成请求被拒绝 ${res.status}：${body.slice(0, 300)}`);
    }
    const chunks: Buffer[] = [];
    let done = false;
    let characters = 0;
    const sse = new SseReader();
    const decoder = new TextDecoder();
    const handle = (data: string): void => {
      for (const f of parseTtsEvent(data)) {
        if (f.kind === 'error') throw new Error(`合成失败：${f.message}`);
        if (f.kind === 'audio') chunks.push(Buffer.from(f.data, 'base64'));
        if (f.kind === 'done') done = true;
        if (f.kind === 'usage') characters = Math.max(characters, f.characters);
      }
    };
    for await (const part of res.body) {
      touch();
      for (const data of sse.push(decoder.decode(part, { stream: true }))) handle(data);
    }
    for (const data of [...sse.push(decoder.decode()), ...sse.end()]) handle(data);
    if (!chunks.length) throw new Error('合成结束但无音频');
    if (!done) throw new Error('合成未正常结束');
    return { mp3: Buffer.concat(chunks), characters: characters || [...req.text].length };
  } catch (e) {
    if (stalled) throw new Error(`合成超时：${STALL_MS / 1000} 秒未收到数据`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
