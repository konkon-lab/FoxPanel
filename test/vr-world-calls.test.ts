import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { worldCalls } from './vr-world-calls.ts';

// 留在空间里的面板：对 SteamVR 和显卡的调用(方法、参数、次序)和记下来的那一份逐条一样。
// 记录里只有绝对位置的调用，没有相对设备的。
// 有意改了这些调用时重新记一份：FOXPANEL_RECORD_CALLS=1 node --test test/vr-world-calls.test.ts
// (把这一遍的调用写进 vr-world-calls.json，不比对)

const RECORDED = new URL('./vr-world-calls.json', import.meta.url);
const RECORD = process.env['FOXPANEL_RECORD_CALLS'] === '1';

test('留在空间里的面板：一遍常用操作里对 SteamVR 和显卡的每一次调用都和记下来的一样', t => {
  const got = worldCalls(t);
  if (RECORD) {
    fs.writeFileSync(RECORDED, `${JSON.stringify(got, null, 1)}
`);
    t.skip(`记下 ${got.length} 次调用`);
    return;
  }
  const want: unknown = JSON.parse(fs.readFileSync(RECORDED, 'utf8'));
  assert.ok(Array.isArray(want));
  const first = got.findIndex((line, i) => line !== want[i]);
  assert.equal(first, -1, `第 ${first + 1} 次调用不一样：${got[first]} ≠ ${String(want[first])}`);
  assert.equal(got.length, want.length);
  assert.equal(got.some(line => line.startsWith('vr.placeOn(')), false);
  assert.ok(got.filter(line => line.startsWith('vr.place(')).length > 50);
});
