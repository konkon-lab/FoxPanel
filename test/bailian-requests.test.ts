import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { synthesize } from '../components/_bailian/tts.ts';
import { translate } from '../components/_bailian/translate.ts';

interface Sent {
  url: string;
  method: string | undefined;
  headers: unknown;
  body: unknown;
}

// 换上假的 fetch：记下请求，用给定的状态和内容回应
function fakeFetch(t: TestContext, status: number, body: string): Sent[] {
  const sent: Sent[] = [];
  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body });
    return Promise.resolve(new Response(body, { status }));
  });
  return sent;
}

const TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const MT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

test('合成请求：地址、请求头、请求体；分块的 SSE 拼成一段 mp3，计费字符取接口给的', async t => {
  const sse = 'id:1\ndata:{"output":{"audio":{"data":"QUJD"}},"usage":{"characters":2}}\n\n'
    + 'id:2\ndata:{"output":{"audio":{"data":"REVG"},"finish_reason":"stop"},"usage":{"characters":4}}\n\n';
  const sent = fakeFetch(t, 200, sse);
  const out = await synthesize('sk-test', { url: TTS_URL, model: 'cosyvoice-v3-flash', voice: 'longhua_v3', text: '你好' });
  assert.deepEqual(sent, [{
    url: TTS_URL,
    method: 'POST',
    headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json', 'X-DashScope-SSE': 'enable' },
    body: '{"model":"cosyvoice-v3-flash","input":{"text":"你好","voice":"longhua_v3","format":"mp3","sample_rate":24000}}',
  }]);
  assert.equal(out.mp3.toString(), 'ABCDEF');
  assert.equal(out.characters, 4);
});

test('合成：接口没给计费字符时按字数；被拒绝、出错、没正常结束都抛出原因', async t => {
  fakeFetch(t, 200, 'data:{"output":{"audio":{"data":"QUJD"},"finish_reason":"stop"}}\n\n');
  const req = { url: TTS_URL, model: 'cosyvoice-v3-flash', voice: 'longhua_v3', text: '你好👋' };
  assert.equal((await synthesize('sk-test', req)).characters, 3);
  fakeFetch(t, 200, 'data:{"output":{"audio":{"data":"QUJD"}}}\n\n');
  await assert.rejects(synthesize('sk-test', req), /未正常结束/);
  fakeFetch(t, 200, 'data:{"code":"InvalidApiKey","message":"Invalid API-key provided."}\n\n');
  await assert.rejects(synthesize('sk-test', req), /合成失败：InvalidApiKey Invalid API-key provided\./);
  fakeFetch(t, 401, 'no');
  await assert.rejects(synthesize('sk-test', req), /合成请求被拒绝 401：no/);
  fakeFetch(t, 400, 'error code: 418');
  await assert.rejects(synthesize('sk-test', req), /音色 longhua_v3 不能用于 cosyvoice-v3-flash/);
});

test('翻译请求：地址、请求头、请求体；返回译文和 Token 用量', async t => {
  const sent = fakeFetch(t, 200, '{"choices":[{"message":{"content":"こんにちは"}}],"usage":{"prompt_tokens":12,"completion_tokens":7}}');
  const out = await translate('sk-test', { url: MT_URL, model: 'qwen-mt-flash', target: 'Japanese', text: '你好' });
  assert.deepEqual(sent, [{
    url: MT_URL,
    method: 'POST',
    headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
    body: '{"model":"qwen-mt-flash","messages":[{"role":"user","content":"你好"}],"translation_options":{"source_lang":"auto","target_lang":"Japanese"}}',
  }]);
  assert.deepEqual(out, { text: 'こんにちは', input: 12, output: 7 });
  fakeFetch(t, 401, 'denied');
  await assert.rejects(translate('sk-test', { url: MT_URL, model: 'qwen-mt-flash', target: 'Japanese', text: '你好' }), /翻译请求被拒绝 401：denied/);
});
