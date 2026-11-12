// 设置页版本一行的徽标和按钮(components/window-settings/src/update-view.ts)：每种更新状态显示什么、按钮做什么。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { badgeOf, buttonOf } from '../components/window-settings/src/update-view.ts';

const STATES = ['idle', 'dev', 'unconfigured', 'checking', 'latest', 'available', 'downloading', 'downloaded', 'error'];

test('徽标：每种状态的文案和色调；开发版和没有更新源的版本各说各的', () => {
  assert.equal(badgeOf({ state: 'idle' }), null);
  assert.deepEqual(badgeOf({ state: 'checking' }), { key: 'upd.checking', params: {}, tone: 'wait' });
  assert.deepEqual(badgeOf({ state: 'latest' }), { key: 'upd.latest', params: {}, tone: 'ok' });
  assert.deepEqual(badgeOf({ state: 'available', version: '1.2.0' }), { key: 'upd.new', params: { v: '1.2.0' }, tone: 'wait' });
  assert.deepEqual(badgeOf({ state: 'downloading', version: '1.2.0', percent: 40 }), { key: 'upd.downloading', params: { p: 40 }, tone: 'wait' });
  assert.deepEqual(badgeOf({ state: 'downloading' }), { key: 'upd.downloading', params: { p: 0 }, tone: 'wait' });
  assert.deepEqual(badgeOf({ state: 'downloaded', version: '1.2.0' }), { key: 'upd.downloaded', params: { v: '1.2.0' }, tone: 'ok' });
  assert.deepEqual(badgeOf({ state: 'downloaded' }), { key: 'upd.downloadedNoVer', params: {}, tone: 'ok' });
  assert.deepEqual(badgeOf({ state: 'error' }), { key: 'upd.failed', params: {}, tone: 'warn' });
  assert.deepEqual(badgeOf({ state: 'dev' }), { key: 'upd.dev', params: {}, tone: 'wait' });
  assert.deepEqual(badgeOf({ state: 'unconfigured' }), { key: 'upd.none', params: {}, tone: 'wait' });
});

test('按钮：下好了是重启并安装，有新版本没下载是下载更新，其余是检查更新；开发版和没有更新源的版本点不了', () => {
  assert.deepEqual(buttonOf('downloaded'), { action: 'install', text: 'upd.restartInstall', disabled: false });
  assert.deepEqual(buttonOf('available'), { action: 'download', text: 'upd.downloadUpdate', disabled: false });
  for (const state of ['idle', 'checking', 'latest', 'downloading', 'error']) assert.deepEqual(buttonOf(state), { action: 'check', text: 'upd.checkUpdate', disabled: false }, state);
  for (const state of ['dev', 'unconfigured']) assert.deepEqual(buttonOf(state), { action: 'check', text: 'upd.checkUpdate', disabled: true }, state);
});

test('更新状态的每一种都对得上；徽标和按钮用到的文案五种语言都有，失败的文案不只说检查', () => {
  // 状态的名单和共用类型里的一样
  const types = fs.readFileSync(path.resolve(import.meta.dirname, '../src/shared/types.ts'), 'utf8');
  const union = /export interface UpdateState \{\n {2}state: ([^;]+);/.exec(types)?.[1] ?? '';
  assert.deepEqual([...union.matchAll(/'([a-z]+)'/g)].map(m => m[1]), STATES);
  const keys = new Set<string>();
  for (const state of STATES) {
    const badge = badgeOf({ state, version: '1.0.0' });
    if (badge) keys.add(badge.key);
    keys.add(buttonOf(state).text);
  }
  keys.add('upd.downloadedNoVer');
  const locales = fs.readFileSync(path.resolve(import.meta.dirname, '../components/window-settings/src/locales.ts'), 'utf8');
  for (const key of keys) assert.equal([...locales.matchAll(new RegExp(`'${key.replace('.', '\\.')}': `, 'g'))].length, 5, key);
  assert.match(locales, /'upd\.failed': '更新失败'/);
  assert.match(locales, /'upd\.failed': 'Update failed'/);
  assert.doesNotMatch(locales, /'upd\.none': '[^']*开发版/);
  // 版本一行用的就是这两个函数
  const row = fs.readFileSync(path.resolve(import.meta.dirname, '../components/window-settings/src/UpdateRow.vue'), 'utf8');
  assert.match(row, /badgeOf\(store\.update\)/);
  assert.match(row, /:disabled="button\.disabled"/);
});
