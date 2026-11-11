import test from 'node:test';
import assert from 'node:assert/strict';
import { fromApi, fromCache } from '../components/window-dashboard/src/quote.ts';

test('每日一言：缓存只认当天的、格式对的', () => {
  const day = '2026-11-10';
  assert.deepEqual(fromCache(JSON.stringify({ text: '句子', from: '作者', day }), day), { text: '句子', from: '作者' });
  assert.deepEqual(fromCache(JSON.stringify({ text: '句子', day }), day), { text: '句子', from: '' });
  assert.equal(fromCache(JSON.stringify({ text: '句子', from: '作者', day: '2026-11-09' }), day), null);
  for (const bad of [null, '', 'not json', 'null', '[]', '"句子"', JSON.stringify({ day }), JSON.stringify({ text: 5, day }), JSON.stringify({ text: '', day })]) {
    assert.equal(fromCache(bad, day), null, String(bad));
  }
  assert.deepEqual(fromCache(JSON.stringify({ text: '句子', from: { name: '作者' }, day }), day), { text: '句子', from: '' });
});

test('每日一言：接口返回取句子，出处优先用作者；格式不对不用', () => {
  assert.deepEqual(fromApi({ hitokoto: '句子', from: '书名', from_who: '作者' }), { text: '句子', from: '作者' });
  assert.deepEqual(fromApi({ hitokoto: '句子', from: '书名', from_who: null }), { text: '句子', from: '书名' });
  assert.deepEqual(fromApi({ hitokoto: '句子' }), { text: '句子', from: '' });
  for (const bad of [null, undefined, '句子', ['句子'], {}, { hitokoto: '' }, { hitokoto: 42 }, { hitokoto: { text: '句子' } }]) {
    assert.equal(fromApi(bad), null);
  }
});
