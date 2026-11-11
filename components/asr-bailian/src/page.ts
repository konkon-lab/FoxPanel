// 听写(媒体页部分)：按主进程部分的指示开关麦克风，转成 16 kHz 单声道 16 位 PCM，每 100 毫秒一帧发回去。

import type { PageContext } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import { ASR_FRAME_MS, ASR_SAMPLE_RATE } from '../../_bailian/pcm.ts';
import { MIC, MIC_ERROR, PCM } from './channels.ts';

const FRAME_SAMPLES = ASR_SAMPLE_RATE * ASR_FRAME_MS / 1000;   // 一帧的采样数

// 音频线程：浮点采样转 16 位 PCM，攒满一帧发出去
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${FRAME_SAMPLES}); this.fill = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (const v of ch) {
      const s = Math.max(-1, Math.min(1, v));
      this.buf[this.fill++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.fill === ${FRAME_SAMPLES}) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(${FRAME_SAMPLES});
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

// 开着的麦克风：采集用的音频上下文和设备的流
interface Capture {
  audio: AudioContext;
  stream: MediaStream;
}

// 把音频线程的代码装进 audio
async function addWorklet(audio: AudioContext): Promise<void> {
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await audio.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 打开麦克风并开始采集，每帧交给 frame；拿到设备后出错时停掉设备、关掉音频上下文再抛出
async function open(deviceId: string, frame: (pcm: ArrayBuffer) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  let audio: AudioContext | undefined;
  try {
    audio = new AudioContext({ sampleRate: ASR_SAMPLE_RATE });
    await addWorklet(audio);
    const node = new AudioWorkletNode(audio, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => frame(e.data);
    audio.createMediaStreamSource(stream).connect(node);
    return { audio, stream };
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    await audio?.close().catch(() => undefined);
    throw e;
  }
}

async function close(c: Capture): Promise<void> {
  for (const t of c.stream.getTracks()) t.stop();
  await c.audio.close();
}

export default {
  name: 'yanuo.asr-bailian',
  apply(ctx: PageContext) {
    const deviceId = String(ctx.config['micDevice'] ?? '');
    let capture: Capture | null = null;

    async function start(): Promise<void> {
      capture ??= await open(deviceId, pcm => ctx.bus.send(PCM, pcm));
    }

    async function stop(): Promise<void> {
      const c = capture;
      capture = null;
      if (c) await close(c);
    }

    // 开和关排成一队依次做：关要等前面的开做完才轮到，麦克风不会在关之后才打开
    let queue = Promise.resolve();
    const enqueue = (step: () => Promise<void>, failed: (e: unknown) => void): void => {
      queue = queue.then(step).catch(failed);
    };
    const turnOn = (): void => enqueue(start, e => ctx.bus.send(MIC_ERROR, errorText(e)));
    const turnOff = (): void => enqueue(stop, e => ctx.log(`close microphone: ${errorText(e)}`, 'warn'));

    ctx.bus.on(MIC, on => (on === true ? turnOn() : turnOff()));
    ctx.effect(() => turnOff);
  },
};
