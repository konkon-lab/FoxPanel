import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { PageContext } from '@konkon-lab/foxpanel-sdk';
import micPlugin from '../components/asr-bailian/src/page.ts';
import { MIC, MIC_ERROR, PCM } from '../components/asr-bailian/src/channels.ts';

// 假的麦克风和音频接口：记下打开过的设备流和音频上下文，getUserMedia 由测试放行
interface Media {
  streams: { stopped: boolean }[];
  audios: { closed: boolean; sampleRate: number; frame?: (pcm: ArrayBuffer) => void }[];
  constraints: unknown[];
  grant(): Promise<void>;   // 放行最早一次在等的 getUserMedia，返回时排着队的开关都做完了
  failWorklet: boolean;     // 音频线程的代码装不上
}

// 等排着队的开关都做完
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function fakeMedia(t: TestContext): Media {
  const waiting: (() => void)[] = [];
  const grant = async (): Promise<void> => {
    await settle();
    waiting.shift()?.();
    await settle();
  };
  const media: Media = { streams: [], audios: [], constraints: [], grant, failWorklet: false };

  class FakeAudioContext {
    readonly record: Media['audios'][number];
    readonly audioWorklet = { addModule: (): Promise<void> => (media.failWorklet ? Promise.reject(new Error('worklet failed')) : Promise.resolve()) };
    constructor(options: { sampleRate: number }) {
      this.record = { closed: false, sampleRate: options.sampleRate };
      media.audios.push(this.record);
    }

    createMediaStreamSource(): { connect(): void } {
      return { connect: () => undefined };
    }

    close(): Promise<void> {
      this.record.closed = true;
      return Promise.resolve();
    }
  }
  class FakeWorkletNode {
    readonly port: { onmessage: ((e: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
    constructor(audio: FakeAudioContext) {
      audio.record.frame = pcm => this.port.onmessage?.({ data: pcm });
    }
  }
  const getUserMedia = (constraints: unknown): Promise<unknown> => new Promise(resolve => {
    media.constraints.push(constraints);
    waiting.push(() => {
      const stream = { stopped: false };
      media.streams.push(stream);
      resolve({ getTracks: () => [{ stop: () => { stream.stopped = true; } }] });
    });
  });

  const real = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), AudioContext: globalThis.AudioContext, AudioWorkletNode: globalThis.AudioWorkletNode };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia } }, configurable: true });
  globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  globalThis.AudioWorkletNode = FakeWorkletNode as unknown as typeof AudioWorkletNode;
  t.after(() => {
    if (real.navigator) Object.defineProperty(globalThis, 'navigator', real.navigator);
    globalThis.AudioContext = real.AudioContext;
    globalThis.AudioWorkletNode = real.AudioWorkletNode;
  });
  return media;
}

// 听写组件的媒体页部分接在假的上下文上
function mountMic(config: Record<string, unknown> = {}): { mic(on: boolean): void; bus: [string, unknown][]; logs: string[]; dispose(): void } {
  const listeners: [string, (data: unknown) => void][] = [];
  const bus: [string, unknown][] = [];
  const logs: string[] = [];
  const disposers: (() => void)[] = [];
  const ctx = {
    config,
    bus: {
      send: (channel: string, data?: unknown) => { bus.push([channel, data]); },
      on: (channel: string, fn: (data: unknown) => void) => { listeners.push([channel, fn]); return () => undefined; },
    },
    log: (text: string) => { logs.push(text); },
    effect: (fn: () => () => void) => { disposers.push(fn()); },
  };
  micPlugin.apply(ctx as unknown as PageContext);
  return {
    mic: on => { for (const [c, fn] of listeners) if (c === MIC) fn(on); },
    bus,
    logs,
    dispose: () => { for (const d of disposers) d(); },
  };
}

test('麦克风：按 16 kHz 单声道打开，采到的帧发回主进程；关掉时停设备、关音频上下文', async t => {
  const media = fakeMedia(t);
  const page = mountMic({ micDevice: 'usb-mic' });
  page.mic(true);
  await media.grant();
  assert.deepEqual(media.constraints, [{ audio: { deviceId: { exact: 'usb-mic' }, channelCount: 1, echoCancellation: true, noiseSuppression: true } }]);
  assert.deepEqual(media.audios.map(a => [a.sampleRate, a.closed]), [[16000, false]]);
  const pcm = new ArrayBuffer(3200);
  media.audios[0]!.frame?.(pcm);
  assert.deepEqual(page.bus, [[PCM, pcm]]);

  page.mic(true);
  await settle();
  assert.equal(media.constraints.length, 1);

  page.mic(false);
  await settle();
  assert.deepEqual([media.streams[0]!.stopped, media.audios[0]!.closed], [true, true]);
  assert.deepEqual(page.logs, []);
});

test('麦克风：开还没做完就关，做完后麦克风是关着的；组件卸载也一样', async t => {
  const media = fakeMedia(t);
  const page = mountMic();
  page.mic(true);
  page.mic(false);
  assert.equal(media.streams.length, 0);
  await media.grant();
  assert.deepEqual(media.constraints, [{ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }]);
  assert.deepEqual(media.streams, [{ stopped: true }]);
  assert.deepEqual(media.audios.map(a => a.closed), [true]);

  page.mic(true);
  page.mic(false);
  page.mic(true);
  await media.grant();
  await media.grant();
  assert.deepEqual(media.streams, [{ stopped: true }, { stopped: true }, { stopped: false }]);

  page.mic(false);
  page.mic(true);
  page.dispose();
  await settle();
  await media.grant();
  assert.equal(media.streams.length, 4);
  assert.ok(media.streams.every(s => s.stopped));
  assert.ok(media.audios.every(a => a.closed));
  assert.deepEqual(page.bus, []);
});

test('麦克风：拿到设备后出错就停掉设备、关音频上下文并报给主进程；之后照常能打开', async t => {
  const media = fakeMedia(t);
  const page = mountMic();
  media.failWorklet = true;
  page.mic(true);
  await media.grant();
  assert.deepEqual(page.bus, [[MIC_ERROR, 'worklet failed']]);
  assert.deepEqual(media.streams, [{ stopped: true }]);
  assert.deepEqual(media.audios.map(a => a.closed), [true]);

  media.failWorklet = false;
  page.mic(true);
  await media.grant();
  assert.deepEqual(media.streams.map(s => s.stopped), [true, false]);
  assert.equal(page.bus.length, 1);
});
