// 翻译：发送前把原文翻译成目标语言(Qwen-MT)；最近的句子缓存起来；按输入、输出 Token 记用量。

import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import { bailianAccount, NO_KEY, recordUsage } from '../../_bailian/account.ts';
import { mtCost } from '../../_bailian/pricing.ts';
import { translate } from '../../_bailian/translate.ts';

const CACHE = 50;   // 缓存的最近译文条数

export default {
  name: 'yanuo.mt-bailian',
  apply(ctx: MainContext) {
    const { key, urls } = bailianAccount(ctx.config);
    const url = urls.mt;
    const model = String(ctx.config['model']);
    const target = String(ctx.config['target']);
    const cache = new Map<string, string>();   // 原文 → 译文，按放进去的先后

    ctx.translator.register(async raw => {
      const text = raw.trim();
      if (!text) return text;
      if (!key) {
        ctx.log(NO_KEY, 'error');
        throw new Error(NO_KEY);
      }
      const hit = cache.get(text);
      if (hit !== undefined) return hit;
      let res: Awaited<ReturnType<typeof translate>>;
      try {
        res = await translate(key, { url, model, target, text });
      } catch (e) {
        ctx.log(`request failed: ${errorText(e)}`, 'warn');
        throw e;
      }
      ctx.log(`translated ${[...text].length} chars to ${target}`);
      recordUsage(ctx, model, { input: res.input, output: res.output }, mtCost(model, res.input, res.output));
      cache.set(text, res.text);
      const oldest = cache.keys().next().value;
      if (cache.size > CACHE && oldest !== undefined) cache.delete(oldest);
      return res.text;
    });
  },
};
