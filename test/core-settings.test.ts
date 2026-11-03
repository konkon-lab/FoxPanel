import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isLanguage, loadSettings, readApp, readPanels, readSettings, saveSettings } from '../src/main/settings.ts';
import { DEFAULT_APP, type LogLevel } from '../src/shared/types.ts';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-config-'));

test('应用设置：缺的项用默认值，名单外的值、类型不对的值修正，缩放限制在 0.5–1.5', () => {
  assert.deepEqual(readApp(undefined), DEFAULT_APP);
  assert.deepEqual(readApp(null), DEFAULT_APP);
  assert.deepEqual(readApp([{ admin: true }]), DEFAULT_APP);
  assert.deepEqual(readApp({ closeAction: 'tray', admin: true, theme: 'dark', zoom: 1.25, autoCheck: false, autoDownload: false, beta: true, navCollapsed: false }),
    { closeAction: 'tray', admin: true, theme: 'dark', zoom: 1.25, autoCheck: false, autoDownload: false, beta: true, navCollapsed: false });
  assert.deepEqual(readApp({ closeAction: 'hide', theme: 5, admin: 'yes', beta: 1 }), DEFAULT_APP);
  assert.equal(readApp({ zoom: 9 }).zoom, 1.5);
  assert.equal(readApp({ zoom: 0.1 }).zoom, 0.5);
  for (const zoom of ['1.2', Number.NaN, Number.POSITIVE_INFINITY, null]) assert.equal(readApp({ zoom }).zoom, DEFAULT_APP.zoom, String(zoom));
});

test('设置：语言只认 system 和五种界面语言；整份不是对象时全用默认值', () => {
  assert.ok(isLanguage('system'));
  assert.ok(isLanguage('ko'));
  assert.ok(!isLanguage('fr'));
  assert.ok(!isLanguage(undefined));
  const dir = tmp();
  try {
    for (const raw of [undefined, null, 5, 'x', []]) {
      const s = readSettings(raw, dir);
      assert.equal(s.language, 'system');
      assert.deepEqual(s.app, DEFAULT_APP);
      assert.deepEqual(s.components.order, []);
      assert.deepEqual(s.panels, { dark: false });
    }
    const s = readSettings({ language: 'ja', app: { theme: 'light' }, components: { order: ['a.b', 5], off: 'a.b', groups: [] } }, dir);
    assert.equal(s.language, 'ja');
    assert.equal(s.app.theme, 'light');
    assert.deepEqual(s.components.order, ['a.b']);
    assert.deepEqual(s.components.off, []);
    assert.equal(readSettings({ language: 'fr' }, dir).language, 'system');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('配置文件：没有文件时用默认设置且不报；保存后读回来一样，不留临时文件', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'config.json');
    const logged: string[] = [];
    const log = (text: string): void => { logged.push(text); };
    const first = loadSettings(file, dir, log);
    assert.equal(logged.length, 0);
    assert.equal(first.language, 'system');
    first.language = 'en';
    first.app = { ...first.app, zoom: 1.2, closeAction: 'quit' };
    first.components.order = ['yanuo.keys'];
    saveSettings(file, first);
    assert.deepEqual(fs.readdirSync(dir), ['config.json']);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')) as object), ['settings']);
    assert.deepEqual(loadSettings(file, dir, log), first);
    assert.equal(logged.length, 0);
    // 再保存一次：换掉已有的文件
    first.language = 'ko';
    saveSettings(file, first);
    assert.equal(loadSettings(file, dir, () => undefined).language, 'ko');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('配置文件：config.json 正被别的句柄开着时保存仍成功，不留临时文件', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'config.json');
    const s = loadSettings(file, dir, () => undefined);
    saveSettings(file, s);
    const fd = fs.openSync(file, 'r');
    try {
      s.language = 'ja';
      s.components.order = ['yanuo.keys'];
      saveSettings(file, s);
    } finally {
      fs.closeSync(fd);
    }
    assert.deepEqual(fs.readdirSync(dir), ['config.json']);
    assert.deepEqual(loadSettings(file, dir, () => undefined), s);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('配置文件：不是 JSON 或内容不是对象时用默认设置，写一行警告并留一份 .bad', () => {
  for (const content of ['{ "settings": { "language": "ja"', 'null', '5', '[]']) {
    const dir = tmp();
    try {
      const file = path.join(dir, 'config.json');
      fs.writeFileSync(file, content);
      const logged: [string, LogLevel | undefined][] = [];
      const s = loadSettings(file, dir, (text, level) => logged.push([text, level]));
      assert.equal(s.language, 'system', content);
      assert.deepEqual(s.app, DEFAULT_APP, content);
      assert.equal(logged.length, 1, content);
      assert.equal(logged[0]?.[1], 'warn', content);
      assert.equal(fs.readFileSync(`${file}.bad`, 'utf8'), content);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('面板的外观：只有写了 true 才是深色，别的都是浅色；存进配置文件后读回来一样', () => {
  assert.deepEqual(readPanels({ dark: true }), { dark: true });
  for (const raw of [undefined, null, 5, [], {}, { dark: false }, { dark: 'true' }, { dark: 1 }, [{ dark: true }]]) assert.deepEqual(readPanels(raw), { dark: false }, JSON.stringify(raw));
  // 多出来的键不留
  assert.deepEqual(readPanels({ dark: true, extra: 1 }), { dark: true });
  const dir = tmp();
  try {
    assert.deepEqual(readSettings({ panels: { dark: true } }, dir).panels, { dark: true });
    const file = path.join(dir, 'config.json');
    const s = loadSettings(file, dir, () => undefined);
    assert.deepEqual(s.panels, { dark: false });
    s.panels = { dark: true };
    saveSettings(file, s);
    assert.deepEqual(loadSettings(file, dir, () => undefined).panels, { dark: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
