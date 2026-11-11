// 听写(主进程部分)：接管听写按钮；开始时让媒体页部分开麦克风，收到的 PCM 送去实时识别，半句显示、整句插入。
// 可以跟随 VRChat 静音键自动开关，可以每说完一句直接发送；按发给百炼的音频秒数记用量。
// 识别结果、听写结束、发送经远程服务 keyboard 交给输入法组件，是否在听写从它的状态里读。

import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { bailianAccount, NO_KEY, recordUsage } from '../../_bailian/account.ts';
import { AsrStream } from '../../_bailian/asr.ts';
import { ASR_BYTES_PER_SEC } from '../../_bailian/pcm.ts';
import { asrCost } from '../../_bailian/pricing.ts';
import { MIC, MIC_ERROR, PCM } from './channels.ts';

const MUTE = '/avatar/parameters/MuteSelf';   // VRChat 的静音状态(OSC 地址)：true / 1 = 静音
const FLUSH_SEC = 10;                         // 识别时长累计到这么多秒记一次用量

// 总线送来的一帧 → 字节；视图只取它自己的那一段。不是二进制数据时为 null
function frameBytes(data: unknown): Uint8Array<ArrayBuffer> | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  return null;
}

export default {
  name: 'yanuo.asr-bailian',
  apply(ctx: MainContext) {
    const c = ctx.config;
    const kb = ctx.relay.use('keyboard');
    const { key, urls } = bailianAccount(c);
    const opts = { url: urls.asr, model: String(c['model']), language: String(c['language']) };
    const sendEach = c['sendEach'] === true;
    let on = false;      // 正在听写
    let bytes = 0;       // 发给百炼、还没记进用量的音频字节
    let sentence = 0;    // 这一句到目前发出的音频字节

    // 识别时长记进用量
    const flush = (): void => {
      const seconds = bytes / ASR_BYTES_PER_SEC;
      bytes = 0;
      if (seconds > 0) recordUsage(ctx, opts.model, { seconds }, asrCost(opts.model, seconds));
    };

    // 停下：关麦克风、断开识别、把剩下的时长记进用量
    const halt = (): void => {
      on = false;
      sentence = 0;
      ctx.bus.send(MIC, false);
      asr.stop();
      flush();
    };

    // 听写不是由按钮停下的(连不上、麦克风打不开)：停下并告诉键盘
    const end = (): void => {
      if (!on) return;
      halt();
      kb.tell('dictationEnded');
    };

    const asr = new AsrStream({
      text: (text, final) => {
        kb.tell('dictated', text, final);
        if (!final) return;
        ctx.log(`recognized ${(sentence / ASR_BYTES_PER_SEC).toFixed(1)}s of audio`);
        sentence = 0;
        if (sendEach) kb.tell('act', { kind: 'send' });
      },
      sent: n => {
        bytes += n;
        sentence += n;
        if (bytes >= FLUSH_SEC * ASR_BYTES_PER_SEC) flush();
      },
      gaveUp: end,
      error: message => ctx.log(`recognize: ${message}`, 'warn'),
    });

    ctx.input.register({
      start() {
        if (!key) {
          ctx.log(NO_KEY, 'error');
          kb.tell('dictationEnded');
          return;
        }
        on = true;
        asr.start(key, opts);
        ctx.bus.send(MIC, true);
      },
      stop: halt,
    });
    ctx.bus.on(PCM, data => {
      const pcm = on ? frameBytes(data) : null;
      if (pcm) asr.push(pcm);
    });
    ctx.bus.on(MIC_ERROR, message => {
      ctx.log(`cannot open microphone: ${String(message)}`, 'error');
      end();
    });

    // 跟随 VRChat 静音键：有 osc 服务时才开；取消静音开始听写，静音停止(和按听写按钮一样)。键盘没有状态时不动
    if (c['followMute'] !== false) {
      ctx.inject(['osc'], inner => {
        const sub = inner as MainContext;
        sub.effect(() => sub.osc.on(MUTE, value => {
          const muted = value === true || value === 1;
          if (muted === kb.state?.dictating) kb.tell('act', { kind: 'dictate' });
        }));
      });
    }
    ctx.effect(() => halt);
  },
};
