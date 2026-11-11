// 语音合成(主进程部分)：收到发送就把译文合成 mp3，按顺序交给媒体页部分播放；每句按计费字符记用量。

import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import { bailianAccount, NO_KEY, recordUsage } from '../../_bailian/account.ts';
import { ttsCost } from '../../_bailian/pricing.ts';
import { modelFor, synthesize, TTS_MAX_CHARS, type CustomVoice } from '../../_bailian/tts.ts';
import { PLAY } from './channels.ts';

export default {
  name: 'yanuo.tts-bailian',
  apply(ctx: MainContext) {
    const c = ctx.config;
    const { key, urls } = bailianAccount(c);
    const url = urls.tts;
    const voice = String(c['voice']);
    const model = modelFor({ model: String(c['model']), voice, customVoices: (c['customVoices'] ?? []) as CustomVoice[] });
    let queue = Promise.resolve();   // 合成排队，一次一句
    let connected = false;           // 第一次合成成功时记一行连上了哪个地址

    async function speak(text: string): Promise<void> {
      if (!key) throw new Error(NO_KEY);
      if ([...text].length > TTS_MAX_CHARS) throw new Error(`at most ${TTS_MAX_CHARS} chars per sentence`);
      const started = Date.now();
      const { mp3, characters } = await synthesize(key, { url, model, voice, text });
      if (!connected) {
        connected = true;
        ctx.log(`connected to ${new URL(url).host}`);
      }
      ctx.log(`synthesized ${[...text].length} chars in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      recordUsage(ctx, model, { chars: characters }, ttsCost(model, characters));
      ctx.bus.send(PLAY, new Uint8Array(mp3));
    }

    ctx.output.register({
      send({ spoken }) {
        const text = spoken.trim();
        if (!text) return;
        queue = queue.then(() => speak(text)).catch((e: unknown) => ctx.log(`synthesize failed: ${errorText(e)}`, 'error'));
      },
    });
  },
};
