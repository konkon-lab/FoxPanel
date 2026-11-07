import test from 'node:test';
import assert from 'node:assert/strict';
import { chatboxText } from '../components/chatbox/src/text.ts';

test('聊天框文字：没翻译只发原文，翻译后是 原文（译文），超过 144 字截断', () => {
  assert.equal(chatboxText('你好', '你好'), '你好');
  assert.equal(chatboxText('你好', 'こんにちは'), '你好（こんにちは）');
  assert.equal([...chatboxText('字'.repeat(200), '字'.repeat(200))].length, 144);
});
