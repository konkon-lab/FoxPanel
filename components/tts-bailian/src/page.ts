// 语音合成(媒体页部分)：合成好的 mp3 按顺序播放到播放设备；开着本地监听且设备不同时，同时在监听设备上播放。

import type { PageContext } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import { PLAY } from './channels.ts';

// 播放一段音频到指定设备(空 = 系统默认)，播完后返回；播不了时抛出
async function playOn(url: string, sinkId: string): Promise<void> {
  const audio = new Audio(url);
  if (sinkId) await audio.setSinkId(sinkId);
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('audio cannot be played'));
    audio.play().catch(reject);
  });
}

export default {
  name: 'yanuo.tts-bailian',
  apply(ctx: PageContext) {
    const out = String(ctx.config['outputDevice'] ?? '');
    const monitor = ctx.config['monitor'] === true;
    const monitorDevice = String(ctx.config['monitorDevice'] ?? '');
    let queue = Promise.resolve();   // 播放排队，一次一句

    async function play(mp3: Uint8Array<ArrayBuffer>): Promise<void> {
      const url = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' }));
      try {
        const runs = [playOn(url, out)];
        if (monitor && monitorDevice !== out) runs.push(playOn(url, monitorDevice));
        await Promise.all(runs);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    ctx.bus.on(PLAY, data => {
      if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) return;
      const mp3 = new Uint8Array(data);
      queue = queue.then(() => play(mp3)).catch((e: unknown) => ctx.log(`play failed: ${errorText(e)}`, 'error'));
    });
  },
};
