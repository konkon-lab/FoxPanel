import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseVersion, satisfies } from '../src/shared/version.ts';

test('版本解析：x.y.z，可以带 v 和预发布后缀', () => {
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion(' v0.10.0-beta.1 '), [0, 10, 0]);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('latest'), null);
});

test('版本比较：忽略预发布后缀，读不出的按 0.0.0', () => {
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0-beta.1'), 0);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('nope', '0.0.1'), -1);
  assert.equal(compareVersions('nope', '0.0.0'), 0);
});

test('宿主版本范围', () => {
  assert.ok(satisfies('0.1.0', '^0.1.0'));
  assert.ok(!satisfies('0.2.0', '^0.1.0'));
  assert.ok(satisfies('1.4.0', '^1.2.3'));
  assert.ok(!satisfies('2.0.0', '^1.2.3'));
  assert.ok(satisfies('1.2.9', '~1.2.0'));
  assert.ok(!satisfies('1.3.0', '~1.2.0'));
  assert.ok(satisfies('0.5.0', '>=0.1.0 <1.0.0'));
  assert.ok(satisfies('2.0.0', '^1.0.0 || ^2.0.0'));
  assert.ok(satisfies('3.0.0', '*'));
  assert.ok(!satisfies('1.0.0', 'latest'));
});
