import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatusItem } from '../src/shared/status.ts';

test('状态栏项：灯和名字必填；多余和格式不对的字段丢掉；卡片里的行只留文字', () => {
  assert.equal(parseStatusItem(null), null);
  assert.equal(parseStatusItem({ led: 'red', label: 'OSC' }), null);
  assert.equal(parseStatusItem({ led: 'ok' }), null);
  assert.deepEqual(parseStatusItem({ led: 'ok', label: 'OSC', value: 3, extra: 1 }), { led: 'ok', label: 'OSC' });
  assert.deepEqual(
    parseStatusItem({ led: 'wait', label: 'OSC', value: '↑ 1/H', state: { 'zh-Hans': '等待' }, rows: [{ label: '发送', value: '127.0.0.1:9000' }, { label: 1 }] }),
    { led: 'wait', label: 'OSC', value: '↑ 1/H', state: { 'zh-Hans': '等待' }, rows: [{ label: '发送', value: '127.0.0.1:9000' }] },
  );
});
