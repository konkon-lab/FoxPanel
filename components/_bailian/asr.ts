// 阿里云百炼 Fun-ASR 实时识别(双工 WebSocket)：持续发送 16 kHz PCM，按句回调识别文本。

import crypto from 'node:crypto';
import { isObject } from '../_shared/util.ts';
import { ASR_FRAME_MS, ASR_SAMPLE_RATE } from './pcm.ts';

const RECONNECT_MS = 1000;                  // 断线后隔多久重连(毫秒)
const MAX_FAILS = 5;                        // 连续未进入 task-started 达到此次数后放弃
const PENDING_MAX = 5000 / ASR_FRAME_MS;    // task-started 之前最多缓存的帧数(5 秒的音频)，超出的丢掉最早的
const SENTENCE_SILENCE_MS = 400;            // 停顿这么久算一句结束(毫秒)

export interface AsrOptions {
  url: string;
  model: string;
  language: string;   // zh / en / ja
}

export interface AsrHandlers {
  text(text: string, final: boolean): void;
  sent(bytes: number): void;   // 这么多字节的音频发给了服务端(缓存里被丢掉的、没连上的不算)
  gaveUp(): void;              // 连续 MAX_FAILS 次没连上，停止重连
  error(message: string): void;
}

export type AsrEvent =
  | { kind: 'started' }
  | { kind: 'text'; text: string; final: boolean }
  | { kind: 'finished' }
  | { kind: 'failed'; message: string }
  | { kind: 'other' };

// 服务端消息里用到的字段；文字类的值类型没有保证，取用时经 str
interface AsrMessage {
  header?: { event?: string; error_code?: unknown; error_message?: unknown };
  payload?: { output?: { heartbeat?: boolean; sentence?: { text?: unknown; sentence_end?: boolean; heartbeat?: boolean } } };
}

// 字符串原样，别的类型当作没有
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// 服务端一条 JSON 消息 → 事件
export function parseAsrMessage(raw: string): AsrEvent {
  let m: AsrMessage;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return { kind: 'other' };
    m = parsed as AsrMessage;
  } catch {
    return { kind: 'other' };
  }
  const h = m.header ?? {};
  switch (h.event) {
    case 'task-started': return { kind: 'started' };
    case 'task-finished': return { kind: 'finished' };
    case 'task-failed': return { kind: 'failed', message: str(h.error_message) ?? str(h.error_code) ?? '识别任务失败' };
    case 'result-generated': {
      const out = m.payload?.output;
      const s = out?.sentence;
      if (!s || out.heartbeat || s.heartbeat) return { kind: 'other' };
      return { kind: 'text', text: str(s.text) ?? '', final: s.sentence_end === true };
    }
    default: return { kind: 'other' };
  }
}

// run-task 指令：PCM 16 kHz，按停顿断句
export function runTaskMessage(taskId: string, opts: AsrOptions): string {
  return JSON.stringify({
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio', task: 'asr', function: 'recognition', model: opts.model,
      parameters: {
        format: 'pcm', sample_rate: ASR_SAMPLE_RATE, semantic_punctuation_enabled: false,
        max_sentence_silence: SENTENCE_SILENCE_MS, heartbeat: true, language_hints: [opts.language],
      },
      input: {},
    },
  });
}

// Node(undici) 的 WebSocket 第二个参数可携带请求头；DOM 类型中无此重载
type HeaderWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

// 一次识别会话：开启后断线自动重连，直到 stop() 或连续失败后放弃
export class AsrStream {
  private readonly handlers: AsrHandlers;
  private ws: WebSocket | null = null;
  private started = false;   // 当前连接收到了 task-started，可以发音频
  private wanted = false;    // start() 之后、stop() 或放弃之前
  private fails = 0;         // 连续几次连接没进入 task-started
  private pending: Uint8Array<ArrayBuffer>[] = [];
  private apiKey = '';
  private opts: AsrOptions = { url: '', model: '', language: 'zh' };

  constructor(handlers: AsrHandlers) {
    this.handlers = handlers;
  }

  start(apiKey: string, opts: AsrOptions): void {
    this.stop();
    this.apiKey = apiKey;
    this.opts = opts;
    this.wanted = true;
    this.fails = 0;
    this.connect();
  }

  // 发送一帧 16 kHz 单声道 16 位 PCM；任务开始前只缓存
  push(pcm: Uint8Array<ArrayBuffer>): void {
    if (!this.wanted) return;
    if (this.started && this.ws?.readyState === WebSocket.OPEN) {
      this.send(this.ws, pcm);
      return;
    }
    this.pending.push(pcm);
    if (this.pending.length > PENDING_MAX) this.pending.shift();
  }

  stop(): void {
    this.wanted = false;
    this.started = false;
    this.pending = [];
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private send(ws: WebSocket, pcm: Uint8Array<ArrayBuffer>): void {
    ws.send(pcm);
    this.handlers.sent(pcm.byteLength);
  }

  private connect(): void {
    const Ws = WebSocket as unknown as HeaderWebSocket;
    const ws = new Ws(this.opts.url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    this.ws = ws;
    this.started = false;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => ws.send(runTaskMessage(crypto.randomUUID().replace(/-/g, ''), this.opts)));
    ws.addEventListener('message', e => {
      if (typeof e.data === 'string') this.onMessage(ws, e.data);
    });
    ws.addEventListener('close', () => this.onClose(ws));
  }

  private onMessage(ws: WebSocket, raw: string): void {
    const ev = parseAsrMessage(raw);
    if (ev.kind === 'started') {
      this.started = true;
      this.fails = 0;
      const pending = this.pending;
      this.pending = [];
      for (const pcm of pending) this.send(ws, pcm);
    } else if (ev.kind === 'text') {
      if (ev.text) this.handlers.text(ev.text, ev.final);
    } else if (ev.kind === 'failed') {
      this.handlers.error(ev.message);
      ws.close();
    } else if (ev.kind === 'finished') {
      ws.close();
    }
  }

  // 连接断开：还要识别就隔 RECONNECT_MS 重连；连续 MAX_FAILS 次没进入 task-started 就放弃
  private onClose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    if (!this.started) this.fails++;
    this.started = false;
    if (!this.wanted) return;
    if (this.fails >= MAX_FAILS) {
      this.wanted = false;
      this.handlers.error('识别连接连续失败，已停止(请检查 API Key 和网络)');
      this.handlers.gaveUp();
      return;
    }
    setTimeout(() => { if (this.wanted && !this.ws) this.connect(); }, RECONNECT_MS);
  }
}
