import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComponentStore } from '../src/main/components/store.ts';
import { readPreinstalled } from '../src/main/components/settings.ts';
import { parseManifest, PART_KINDS, type Manifest } from '../src/shared/manifest.ts';
import type { ComponentSettings } from '../src/shared/types.ts';

// 用仓库里预装组件和示例组件的清单查：键盘面板里用 kb 的组件，清单里都写了要远程服务 keyboard(kb 由输入法组件的页面部分提供)；
// 键盘面板的计划：根是经典外壳，五个插槽里是各部件，服务里有输入法和按键渲染的页面部分；关掉输入法后这些部件不进面板。

const ROOT = path.resolve(import.meta.dirname, '..');
const PRE = path.join(ROOT, 'components');
const IME = 'yanuo.ime';
const EMPTY: ComponentSettings = { order: [], off: [], config: {}, removed: [], dev: [], devMode: false, groups: [], folded: [], names: {}, market: { registry: 'https://registry.npmmirror.com', scripts: false } };

// 组件源码里用了页面的 kb 服务：读 ctx.kb，或在 inject 里写了 'kb'
const USES_KB = /\bctx\.kb\b|'kb'/;

// 文件夹里的源码文件(.ts / .vue / .js)，含子文件夹
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return sources(file);
    return /\.(ts|vue|js)$/.test(e.name) ? [file] : [];
  });
}

const usesKb = (dir: string): boolean => sources(dir).some(f => USES_KB.test(fs.readFileSync(f, 'utf8')));

function manifestIn(dir: string): Manifest {
  const r = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')));
  if (!r.ok) assert.fail(`${dir}：${r.errors.join('；')}`);
  return r.manifest;
}

// 预装组件：id → 源码文件夹
const preinstalled = new Map(readPreinstalled(PRE).ids.map(id => [id, path.join(PRE, id.split('.')[1] ?? id)] as const));

// 把预装组件的清单(和布局 JSON)放进一个临时的组件目录，扫描出来
function install(t: { after(fn: () => void): void }): ComponentStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-parts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [id, src] of preinstalled) {
    const dest = path.join(root, 'installed', id);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(src, 'component.json'), path.join(dest, 'component.json'));
    const layout = manifestIn(src).layout;
    if (layout) fs.copyFileSync(path.join(src, layout), path.join(dest, layout));
  }
  const store = new ComponentStore({ dir: path.join(root, 'installed'), preinstalled: PRE, log: () => undefined });
  store.scan([]);
  assert.deepEqual(store.broken, []);
  return store;
}

const KEYBOARD_PANEL = 'yanuo.shell-classic';

test('键盘面板里的组件：源码里用 kb 的，清单都写了 requires keyboard；日夜切换不用 kb；输入法只提供 keyboard', () => {
  assert.ok(preinstalled.size > 0);
  const using: string[] = [];
  for (const [id, dir] of preinstalled) {
    const m = manifestIn(dir);
    // 面板页面加载的是各部件和服务组件的页面代码；输入法自己是提供 kb 的
    if ((!PART_KINDS.has(m.kind) && m.kind !== 'service' && m.kind !== 'panel') || (!m.page && !m.panel) || id === IME) continue;
    if (!usesKb(path.join(dir, 'src'))) continue;
    using.push(id);
    assert.ok(m.requires?.includes('keyboard'), `${id} 用了 kb，清单里没有 requires keyboard`);
  }
  assert.deepEqual(using.sort(), [
    'yanuo.button-paste', 'yanuo.candidates', 'yanuo.keys', 'yanuo.side-numpad', 'yanuo.side-quick', 'yanuo.side-symbols', 'yanuo.textfield',
  ]);
  const theme = manifestIn(preinstalled.get('yanuo.button-theme') ?? assert.fail('预装列表里没有日夜切换'));
  assert.deepEqual([theme.requires, theme.uses], [undefined, undefined]);

  // 输入法的页面部分由面板的服务带进来，清单不用写自己用自己提供的服务
  const ime = manifestIn(preinstalled.get(IME) ?? assert.fail('预装列表里没有输入法组件'));
  assert.deepEqual([ime.provides, ime.requires, ime.uses, ime.page], [['keyboard'], undefined, undefined, 'page.js']);
  assert.ok(fs.existsSync(path.join(preinstalled.get(IME) ?? '', 'src', 'page.ts')));

  // 示例组件
  for (const name of fs.readdirSync(path.join(ROOT, 'examples'))) {
    const dir = path.join(ROOT, 'examples', name);
    if (!fs.existsSync(path.join(dir, 'component.json')) || !usesKb(dir)) continue;
    assert.ok(manifestIn(dir).requires?.includes('keyboard'), `示例 ${name} 用了 kb，清单里没有 requires keyboard`);
  }
  assert.ok(usesKb(path.join(ROOT, 'examples', 'side-phrases')));
});

test('键盘面板里的组件：只有布局 JSON 的布局经按键渲染用 kb，清单要 keys，keys 要 keyboard', () => {
  const layouts = [...preinstalled.values(), ...fs.readdirSync(path.join(ROOT, 'examples')).map(n => path.join(ROOT, 'examples', n))]
    .filter(dir => fs.existsSync(path.join(dir, 'component.json')))
    .map(manifestIn)
    .filter(m => m.kind === 'layout' && !m.page);
  assert.ok(layouts.length > 0);
  for (const m of layouts) assert.ok(m.requires?.includes('keys'), m.id);
  const keys = [...preinstalled.values()].map(manifestIn).filter(m => m.provides?.includes('keys'));
  assert.deepEqual(keys.map(m => m.requires), [['keyboard']]);
});

test('预装组件的面板：只有键盘一块，根是经典外壳，五个插槽里是各部件，服务里有输入法和按键渲染的页面部分，够得着 keyboard', t => {
  const store = install(t);
  const on: ComponentSettings = { ...EMPTY, order: [...preinstalled.keys()] };
  const infos = store.panelInfos(on);
  assert.deepEqual(infos.map(p => p.id), [KEYBOARD_PANEL]);
  const info = infos[0];
  assert.deepEqual(
    [info?.width, info?.height, info?.scale, info?.fps, info?.meters, info?.minMeters, info?.maxMeters, info?.anchor, info?.spawn, info?.keep],
    [1400, 490, 1, 60, 0.8, 0.4, 1.6, 'world', 'low', true],
  );

  const plans = store.panelPlans(on);
  assert.equal(plans.length, 1);
  const plan = plans[0] ?? assert.fail('没有键盘面板的计划');
  assert.deepEqual([plan.kind, plan.id, plan.size, plan.sound, plan.skin], ['panel', KEYBOARD_PANEL, { width: 1400, height: 490 }, true, null]);
  assert.deepEqual([plan.root.id, plan.root.kind], [KEYBOARD_PANEL, 'panel']);
  assert.match(plan.root.url, /^fox:\/\/component\/yanuo\.shell-classic\/panel\.js\?t=\d+$/);
  assert.deepEqual(Object.fromEntries(Object.entries(plan.parts).map(([slot, list]) => [slot, list.map(c => c.id)])), {
    candidates: ['yanuo.candidates'],
    textfield: ['yanuo.textfield'],
    layout: ['yanuo.layout-d68'],
    sidepage: ['yanuo.side-quick', 'yanuo.side-numpad', 'yanuo.side-symbols'],
    sidebutton: ['yanuo.button-paste', 'yanuo.button-theme'],
  });
  // 部件的类别就是插槽名；预装的键盘布局只有布局 JSON，别的部件都有入口
  for (const [slot, list] of Object.entries(plan.parts)) {
    for (const c of list) {
      assert.equal(c.kind, slot, c.id);
      assert.equal('layout' in c, c.id === 'yanuo.layout-d68', c.id);
    }
  }
  assert.deepEqual(plan.services.map(c => c.id), ['yanuo.keys', IME]);
  for (const c of plan.services) assert.match(c.url, /\/page\.js\?t=\d+$/, c.id);
  assert.deepEqual([...plan.remotes].sort(), ['keyboard', 'keys']);
});

test('预装组件的面板：关掉输入法后键盘面板还在，插槽里只剩不用 kb 的部件，不带服务，够不着 keyboard', t => {
  const store = install(t);
  const on: ComponentSettings = { ...EMPTY, order: [...preinstalled.keys()] };
  const off: ComponentSettings = { ...on, off: [IME] };
  const plan = store.panelPlans(off)[0] ?? assert.fail('没有键盘面板的计划');
  assert.equal(plan.id, KEYBOARD_PANEL);
  assert.deepEqual(Object.fromEntries(Object.entries(plan.parts).map(([slot, list]) => [slot, list.map(c => c.id)])), {
    candidates: [], textfield: [], layout: [], sidepage: [], sidebutton: ['yanuo.button-theme'],
  });
  assert.deepEqual([plan.services, plan.remotes], [[], []]);
  // 留下的组件源码里不用 kb
  for (const id of [KEYBOARD_PANEL, 'yanuo.button-theme']) assert.ok(!usesKb(path.join(preinstalled.get(id) ?? '', 'src')), id);
  // 面板目录不变；主窗口的组件、输出和服务不受影响
  assert.deepEqual(store.panelInfos(off).map(p => p.id), [KEYBOARD_PANEL]);
  const active = new Set(store.active(off).map(c => c.manifest.id));
  for (const id of ['yanuo.window-shell', 'yanuo.window-components', 'yanuo.osc', 'yanuo.chatbox', 'yanuo.lang-zh']) assert.ok(active.has(id), id);
  for (const id of ['yanuo.candidates', 'yanuo.textfield', 'yanuo.keys', 'yanuo.layout-d68', 'yanuo.side-quick', 'yanuo.button-paste']) assert.ok(!active.has(id), id);

  // 输入法开着、要它的部件都关掉：面板里没有人要 keyboard，输入法的页面部分不进面板
  const parts = store.panelPlans(on).flatMap(p => [...Object.values(p.parts).flat(), ...p.services]).map(c => c.id);
  const alone: ComponentSettings = { ...on, off: parts.filter(id => id !== IME && id !== 'yanuo.button-theme') };
  const few = store.panelPlans(alone)[0] ?? assert.fail('没有键盘面板的计划');
  assert.deepEqual([Object.values(few.parts).flat().map(c => c.id), few.services, few.remotes], [['yanuo.button-theme'], [], []]);
  // 关掉经典外壳：没有面板了
  assert.deepEqual(store.panelPlans({ ...on, off: [KEYBOARD_PANEL] }), []);
});
