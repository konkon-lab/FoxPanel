// 阿里云百炼的单价(中国内地/北京，人民币)；表里没有的模型返回 undefined(只记用量不算钱)。

// 元 / 万字符
const TTS_PRICE: Readonly<Record<string, number>> = {
  'cosyvoice-v3-flash': 1, 'cosyvoice-v3-plus': 2, 'cosyvoice-v3.5-flash': 0.8, 'cosyvoice-v3.5-plus': 1.5,
};
// 元 / 百万 Token
const MT_PRICE: Readonly<Record<string, { input: number; output: number }>> = {
  'qwen-mt-flash': { input: 0.7, output: 1.95 }, 'qwen-mt-plus': { input: 1.8, output: 5.4 },
};
// 元 / 秒
const ASR_PRICE: Readonly<Record<string, number>> = { 'fun-asr-realtime': 0.00033 };

export function ttsCost(model: string, chars: number): number | undefined {
  const p = TTS_PRICE[model];
  return p === undefined ? undefined : (chars / 10000) * p;
}

export function mtCost(model: string, input: number, output: number): number | undefined {
  const p = MT_PRICE[model];
  return p === undefined ? undefined : (input * p.input + output * p.output) / 1e6;
}

export function asrCost(model: string, seconds: number): number | undefined {
  const p = ASR_PRICE[model];
  return p === undefined ? undefined : seconds * p;
}
