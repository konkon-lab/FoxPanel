// 百炼的接入域名 → 合成、识别、翻译的接口地址。

const DEFAULT_DOMAIN = 'dashscope.aliyuncs.com';

export interface BailianUrls {
  tts: string;
  asr: string;
  mt: string;
}

// 用户填写的域名 → 小写的主机名(不带协议、路径和首尾空白)
export function normalizeDomain(input: string): string {
  return input.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
}

// 域名没填时用 DEFAULT_DOMAIN
export function bailianUrls(domain: string): BailianUrls {
  const d = normalizeDomain(domain) || DEFAULT_DOMAIN;
  return {
    tts: `https://${d}/api/v1/services/audio/tts/SpeechSynthesizer`,
    asr: `wss://${d}/api-ws/v1/inference`,
    mt: `https://${d}/compatible-mode/v1/chat/completions`,
  };
}
