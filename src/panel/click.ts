// 按键音：波形和播放。机械键盘青轴那种脆响：很短的高频“咔”(簧片弹开)，7–9 毫秒后是键帽触底的“哒”(几千赫的共振加一点低频键身)。
// strong = 带 data-strong 的按钮(发送)，触底声更低更厚。

// 固定种子的伪随机数，每次生成的声音一样
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

// 一次按键的采样(单声道，-1 到 1)；只依赖采样率
export function clickSamples(rate: number, strong: boolean): Float32Array<ArrayBuffer> {
  const len = Math.round(rate * (strong ? 0.06 : 0.045));   // 全长 45 / 60 毫秒
  const out = new Float32Array(len);
  const rnd = noise(strong ? 7 : 3);
  const clickAt = 0;                                   // “咔”
  const bottomAt = Math.round(rate * (strong ? 0.009 : 0.007));   // “哒”在 7–9 毫秒后
  const ring = strong ? 2300 : 3400;                   // 触底共振(赫兹)
  const body = strong ? 170 : 320;                     // 键身低频(赫兹)
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    // 高通后的白噪声：一阶高通，截止约 2.5 kHz
    const n = rnd();
    hp = 0.72 * (hp + n - prev);
    prev = n;
    // 各段按指数衰减：exp(-t / 时间常数(秒)) × 音量
    let v = 0;
    const tc = (i - clickAt) / rate;
    v += hp * Math.exp(-tc / 0.0006) * 0.9;
    if (i >= bottomAt) {
      const tb = (i - bottomAt) / rate;
      v += hp * Math.exp(-tb / 0.0009) * 0.55;
      v += Math.sin(2 * Math.PI * ring * tb) * Math.exp(-tb / 0.0035) * 0.35;
      v += Math.sin(2 * Math.PI * body * tb) * Math.exp(-tb / (strong ? 0.012 : 0.007)) * (strong ? 0.45 : 0.25);
    }
    out[i] = Math.max(-1, Math.min(1, v));
  }
  // 结尾 1 毫秒淡出，免得爆音
  const fade = Math.round(rate * 0.001);
  for (let i = 0; i < fade; i++) {
    out[len - 1 - i]! *= i / fade;
  }
  return out;
}

const PITCH_MIN = 0.94;      // 播放速度的下限(倍)
const PITCH_SPREAD = 0.12;   // 每次播放速度在下限之上随机多出的范围(倍)
const GAIN = 0.4;            // 普通键的音量(0–1)
const GAIN_STRONG = 0.5;     // 大键的音量

// 首次按键时生成的两段波形(普通键 / 大键)，之后反复播放
let audio: { ctx: AudioContext; normal: AudioBuffer; strong: AudioBuffer } | null = null;

function makeBuffer(ctx: AudioContext, strong: boolean): AudioBuffer {
  const samples = clickSamples(ctx.sampleRate, strong);
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.copyToChannel(samples, 0);
  return buf;
}

// 播一声，每次音高随机差一点
function click(strong: boolean): void {
  if (!audio) {
    const ctx = new AudioContext();
    audio = { ctx, normal: makeBuffer(ctx, false), strong: makeBuffer(ctx, true) };
  }
  const { ctx } = audio;
  const src = ctx.createBufferSource();
  src.buffer = strong ? audio.strong : audio.normal;
  src.playbackRate.value = PITCH_MIN + Math.random() * PITCH_SPREAD;
  const gain = ctx.createGain();
  gain.gain.value = strong ? GAIN_STRONG : GAIN;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

// 页面里任何可用的按钮按下都响；带 data-strong 的用大键音
export function installClick(): void {
  document.addEventListener('mousedown', e => {
    const el = (e.target as HTMLElement | null)?.closest('button');
    if (el && !el.disabled) click(el.dataset['strong'] !== undefined);
  });
}
