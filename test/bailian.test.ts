import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFor, parseTtsEvent, SseReader } from '../components/_bailian/tts.ts';
import { parseAsrMessage, runTaskMessage } from '../components/_bailian/asr.ts';
import { extractTranslation, extractUsage, translateBody } from '../components/_bailian/translate.ts';
import { bailianUrls, normalizeDomain } from '../components/_bailian/endpoints.ts';
import { asrCost, mtCost, ttsCost } from '../components/_bailian/pricing.ts';

test('合成 SSE：音频帧、结束帧(可带音频)、错误帧、坏数据', () => {
  assert.deepEqual(parseTtsEvent('{"output":{"audio":{"data":"QUJD"}}}'), [{ kind: 'audio', data: 'QUJD' }]);
  assert.deepEqual(parseTtsEvent('{"output":{"audio":{"data":"REVG"},"finish_reason":"stop"},"usage":{"characters":3}}'),
    [{ kind: 'audio', data: 'REVG' }, { kind: 'usage', characters: 3 }, { kind: 'done' }]);
  assert.deepEqual(parseTtsEvent('{"output":{"finish_reason":"stop"}}'), [{ kind: 'done' }]);
  assert.deepEqual(parseTtsEvent('{"code":"InvalidApiKey","message":"Invalid API-key provided."}'),
    [{ kind: 'error', message: 'InvalidApiKey Invalid API-key provided.' }]);
  assert.deepEqual(parseTtsEvent('{坏的'), []);
  assert.deepEqual(parseTtsEvent('null'), []);
  assert.deepEqual(parseTtsEvent('{"output":{}}'), []);
});

test('SSE 分事件：单行和分多行的 data 都拼成一个事件，跨数据块、CRLF、最后没空行也行', () => {
  const r = new SseReader();
  assert.deepEqual(r.push('id:1\nevent:result\ndata:{"a":1}\n\nid:2\ndata:{\n'), ['{"a":1}']);
  assert.deepEqual(r.push('data:  "b" : 2\r\ndata:}\n'), []);
  assert.deepEqual(r.push('\nid:3\ndata: {"c":3}'), ['{\n "b" : 2\n}']);
  assert.deepEqual(r.end(), ['{"c":3}']);
});

test('识别消息：开始、句中、句末、心跳、失败', () => {
  assert.deepEqual(parseAsrMessage('{"header":{"event":"task-started"}}'), { kind: 'started' });
  assert.deepEqual(parseAsrMessage('{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"你好","sentence_end":false}}}}'),
    { kind: 'text', text: '你好', final: false });
  assert.deepEqual(parseAsrMessage('{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"你好。","sentence_end":true}}}}'),
    { kind: 'text', text: '你好。', final: true });
  assert.deepEqual(parseAsrMessage('{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"heartbeat":true}}}}'), { kind: 'other' });
  assert.deepEqual(parseAsrMessage('{"header":{"event":"task-failed","error_message":"bad key"}}'), { kind: 'failed', message: 'bad key' });
  assert.deepEqual(parseAsrMessage('{"header":{"event":"task-finished"}}'), { kind: 'finished' });
  assert.deepEqual(parseAsrMessage('null'), { kind: 'other' });
  assert.deepEqual(parseAsrMessage('{坏的'), { kind: 'other' });
});

test('识别消息：文字、错误信息不是字符串时当作没有', () => {
  const sentence = (s: Record<string, unknown>): string => JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: s } } });
  assert.deepEqual(parseAsrMessage(sentence({ text: 123, sentence_end: false })), { kind: 'text', text: '', final: false });
  assert.deepEqual(parseAsrMessage(sentence({ text: { a: 1 }, sentence_end: true })), { kind: 'text', text: '', final: true });
  assert.deepEqual(parseAsrMessage(sentence({ text: ['你好'] })), { kind: 'text', text: '', final: false });
  assert.deepEqual(parseAsrMessage(sentence({ sentence_end: true })), { kind: 'text', text: '', final: true });
  const failed = (fields: Record<string, unknown>): string => JSON.stringify({ header: { event: 'task-failed', ...fields } });
  assert.deepEqual(parseAsrMessage(failed({ error_message: 5, error_code: 'InvalidApiKey' })), { kind: 'failed', message: 'InvalidApiKey' });
  assert.deepEqual(parseAsrMessage(failed({ error_message: { a: 1 }, error_code: 7 })), { kind: 'failed', message: '识别任务失败' });
  assert.deepEqual(parseAsrMessage(failed({ error_code: 'InvalidApiKey' })), { kind: 'failed', message: 'InvalidApiKey' });
  assert.deepEqual(parseAsrMessage(failed({ error_message: '', error_code: 'InvalidApiKey' })), { kind: 'failed', message: '' });
  assert.deepEqual(parseAsrMessage(failed({})), { kind: 'failed', message: '识别任务失败' });
});

test('run-task 指令带模型、16 kHz PCM 和识别语言', () => {
  const m = JSON.parse(runTaskMessage('abc', { url: 'wss://x', model: 'fun-asr-realtime', language: 'ja' })) as {
    header: { action: string; task_id: string };
    payload: { model: string; parameters: { format: string; sample_rate: number; language_hints: string[] } };
  };
  assert.equal(m.header.action, 'run-task');
  assert.equal(m.header.task_id, 'abc');
  assert.equal(m.payload.model, 'fun-asr-realtime');
  assert.deepEqual([m.payload.parameters.format, m.payload.parameters.sample_rate], ['pcm', 16000]);
  assert.deepEqual(m.payload.parameters.language_hints, ['ja']);
});

test('自定义音色绑定了模型时用它的模型，其他音色用设置里的模型', () => {
  const customVoices = [{ name: '我的声音', id: 'cosyvoice-v3.5-plus-abc', model: 'cosyvoice-v3.5-plus' }, { name: '没绑模型', id: 'x1', model: '' }];
  assert.equal(modelFor({ model: 'cosyvoice-v3-flash', voice: 'cosyvoice-v3.5-plus-abc', customVoices }), 'cosyvoice-v3.5-plus');
  assert.equal(modelFor({ model: 'cosyvoice-v3-flash', voice: 'x1', customVoices }), 'cosyvoice-v3-flash');
  assert.equal(modelFor({ model: 'cosyvoice-v3-flash', voice: 'longhua_v3', customVoices }), 'cosyvoice-v3-flash');
});

test('翻译请求：一条 user 消息，源语言自动、目标语言照设置', () => {
  const body = JSON.parse(translateBody({ model: 'qwen-mt-flash', target: 'Japanese', text: '你好' })) as {
    model: string; messages: { role: string; content: string }[]; translation_options: { source_lang: string; target_lang: string };
  };
  assert.equal(body.model, 'qwen-mt-flash');
  assert.deepEqual(body.messages, [{ role: 'user', content: '你好' }]);
  assert.deepEqual(body.translation_options, { source_lang: 'auto', target_lang: 'Japanese' });
});

test('翻译响应：取第一条译文；出错时报出原因', () => {
  assert.equal(extractTranslation('{"choices":[{"message":{"role":"assistant","content":" こんにちは "}}]}'), 'こんにちは');
  assert.throws(() => extractTranslation('{"error":{"message":"Invalid API-key provided."}}'), /Invalid API-key/);
  assert.throws(() => extractTranslation('<html>'), /不是 JSON/);
  assert.throws(() => extractTranslation('null'), /不是 JSON/);
  assert.throws(() => extractTranslation('{"choices":[{"message":{"content":5}}]}'), /翻译失败/);
});

test('翻译响应里的 Token 用量：缺失或不是数字时按 0', () => {
  assert.deepEqual(extractUsage('{"usage":{"prompt_tokens":12,"completion_tokens":7}}'), { input: 12, output: 7 });
  assert.deepEqual(extractUsage('{"usage":{"prompt_tokens":"12"}}'), { input: 0, output: 0 });
  assert.deepEqual(extractUsage('null'), { input: 0, output: 0 });
  assert.deepEqual(extractUsage('<html>'), { input: 0, output: 0 });
});

test('接入根域名：去掉协议和路径后补全三个接口地址', () => {
  assert.equal(normalizeDomain(' https://DashScope-intl.aliyuncs.com/api/v1 '), 'dashscope-intl.aliyuncs.com');
  assert.deepEqual(bailianUrls('dashscope-intl.aliyuncs.com'), {
    tts: 'https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    asr: 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference',
    mt: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  });
  assert.equal(bailianUrls('').tts, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
});

test('百炼计费：合成按万字符、翻译按百万 Token、识别按秒；表里没有的模型不算钱', () => {
  assert.equal(ttsCost('cosyvoice-v3-flash', 5000), 0.5);
  assert.equal(ttsCost('cosyvoice-v3.5-plus', 10000), 1.5);
  assert.equal(mtCost('qwen-mt-flash', 1e6, 1e6), 0.7 + 1.95);
  assert.ok(Math.abs((asrCost('fun-asr-realtime', 100) ?? 0) - 0.033) < 1e-9);
  assert.equal(ttsCost('my-model', 100), undefined);
  assert.equal(mtCost('qwen-mt-lite', 1, 1), undefined);
});
