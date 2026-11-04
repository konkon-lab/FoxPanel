import test from 'node:test';
import assert from 'node:assert/strict';
import { clickSamples } from '../src/panel/click.ts';

test('按键音：长度按采样率算，大键更长；每次生成的一样，不削波，结尾淡到 0', () => {
  for (const rate of [44100, 48000]) {
    const normal = clickSamples(rate, false);
    const strong = clickSamples(rate, true);
    assert.equal(normal.length, Math.round(rate * 0.045));
    assert.equal(strong.length, Math.round(rate * 0.06));
    assert.deepEqual(clickSamples(rate, false), normal);
    for (const s of [normal, strong]) {
      assert.ok(s.every(v => v >= -1 && v <= 1));
      assert.ok(s.some(v => Math.abs(v) > 0.2));
      assert.equal(Math.abs(s.at(-1)!), 0);
    }
    assert.notDeepEqual(Array.from(strong.subarray(0, normal.length)), Array.from(normal));
  }
});
