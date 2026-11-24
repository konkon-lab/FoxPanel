// 设置页版本一行的徽标和按钮、新版本弹窗(components/window-settings/src/update-view.ts)：每种更新状态显示什么、按钮做什么，弹窗开不开。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { badgeOf, buttonOf, progressOf, promptButtonOf, promptOf } from '../components/window-settings/src/update-view.ts';

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

// ---------- 新版本弹窗 ----------

test('新版本弹窗：发现了、下载中、下好了且知道版本号时开着；点过「稍后」、说了跳过的那个版本不再开，换了一个版本又开', () => {
  for (const state of ['available', 'downloading', 'downloaded']) {
    assert.equal(promptOf({ state, version: '1.2.0' }, null), true, state);
    assert.equal(promptOf({ state, version: '1.2.0' }, null, '1.2.0'), false, state);
    assert.equal(promptOf({ state, version: '1.3.0' }, null, '1.2.0'), true, state);
    assert.equal(promptOf({ state, version: '1.3.0' }, '1.3.0', '1.2.0'), false, state);
    assert.equal(promptOf({ state, version: '1.2.0' }, '1.2.0'), false, state);
    assert.equal(promptOf({ state, version: '1.3.0' }, '1.2.0'), true, state);
    assert.equal(promptOf({ state }, null), false, state);
    assert.equal(promptOf({ state, version: '' }, null), false, state);
  }
  for (const state of ['idle', 'dev', 'unconfigured', 'checking', 'latest', 'error']) assert.equal(promptOf({ state, version: '1.2.0' }, null), false, state);
});

test('新版本弹窗：左下角下载中是进度和进度条，下好了是一句话，没下载时没有；主按钮下载中点不了', () => {
  assert.deepEqual(progressOf({ state: 'downloading', version: '1.2.0', percent: 42 }), { key: 'upd.bgDownloading', params: { p: 42 }, percent: 42 });
  assert.deepEqual(progressOf({ state: 'downloading' }), { key: 'upd.bgDownloading', params: { p: 0 }, percent: 0 });
  assert.deepEqual(progressOf({ state: 'downloaded', version: '1.2.0' }), { key: 'upd.ready', params: {}, percent: null });
  for (const state of ['available', 'idle', 'error']) assert.equal(progressOf({ state }), null, state);
  assert.deepEqual(promptButtonOf('available'), { action: 'download', text: 'upd.downloadUpdate', disabled: false });
  assert.deepEqual(promptButtonOf('downloading'), { action: 'install', text: 'upd.restartInstall', disabled: true });
  assert.deepEqual(promptButtonOf('downloaded'), { action: 'install', text: 'upd.restartInstall', disabled: false });
});

test('新版本弹窗：用到的文案五种语言都有；弹窗登记在整个窗口上，条目当文字画，不把发布说明当 HTML 放进页面', () => {
  const locales = fs.readFileSync(path.resolve(import.meta.dirname, '../components/window-settings/src/locales.ts'), 'utf8');
  for (const key of ['upd.found', 'upd.current', 'upd.noNotes', 'upd.later', 'upd.bgDownloading', 'upd.ready', 'upd.released', 'upd.releasePage', 'upd.skip']) {
    assert.equal([...locales.matchAll(new RegExp(`'${key.replace('.', '\\.')}': `, 'g'))].length, 5, key);
  }
  const dialog = fs.readFileSync(path.resolve(import.meta.dirname, '../components/window-settings/src/UpdateDialog.vue'), 'utf8');
  assert.match(dialog, /promptOf\(store\.update, dismissed\.value, skipped\.value\)/);
  // 发布页用浏览器打开，更新源给了才有这个链接
  assert.match(dialog, /v-if="store\.update\.url"/);
  assert.match(dialog, /fox\.openExternal\(store\.update\.url\)/);
  assert.match(dialog, /promptButtonOf\(store\.update\.state\)/);
  assert.doesNotMatch(dialog, /v-html|innerHTML/);
  const page = fs.readFileSync(path.resolve(import.meta.dirname, '../components/window-settings/src/page.ts'), 'utf8');
  assert.match(page, /ctx\.window\.slot\(\{ type: 'app', component: UpdateDialog \}\);/);
});
