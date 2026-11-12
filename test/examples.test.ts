import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nextTick, reactive, ref } from 'vue';
import { pack } from '../scripts/pack-component.ts';
import { ComponentStore, TAR } from '../src/main/components/store.ts';
import { parseManifest, textOf, type Manifest, type Text } from '../src/shared/manifest.ts';
import { parseSummary } from '../src/shared/market.ts';
import { LOCALES, type ComponentSettings, type Locale } from '../src/shared/types.ts';
import { isObject } from '../src/shared/util.ts';

// 示例组件(examples/)：清单都合格、写到的文件都在、都能打成 zip 和 npm 包；时钟面板的清单、页面代码的行为、装上之后的面板计划；
// 手腕时钟(附着在左手上的小面板)的清单、打包、装上之后在面板目录里的样子、页面代码的行为。

const ROOT = path.resolve(import.meta.dirname, '..');
const EXAMPLES = path.join(ROOT, 'examples');
const CLOCK = path.join(EXAMPLES, 'panel-clock');
const CLOCK_ID = 'yanuo.panel-clock';
const WRIST = path.join(EXAMPLES, 'panel-wrist');
const WRIST_ID = 'yanuo.panel-wrist';
const EMPTY: ComponentSettings = { order: [], off: [], config: {}, removed: [], dev: [], devMode: false, groups: [], folded: [], names: {}, market: { registry: 'https://registry.npmmirror.com', scripts: false } };

const folders = fs.readdirSync(EXAMPLES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(EXAMPLES, e.name));

function manifestIn(dir: string): Manifest {
  const r = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')));
  if (!r.ok) assert.fail(`${dir}：${r.errors.join('；')}`);
  return r.manifest;
}

// 压缩包里的文件(/ 分隔，文件夹不带末尾的 /)
const entries = (file: string): string[] => execFileSync(TAR, ['-tf', file], { encoding: 'utf8' })
  .split(/\r?\n/).map(line => line.trim().replace(/\/$/, '')).filter(Boolean);

test('示例组件：清单都合格，写到的入口、图标、皮肤、布局文件都在，各有说明和许可证', () => {
  assert.deepEqual(folders.map(d => path.basename(d)).sort(), ['lang-xiaohe', 'layout-ru', 'output-discord', 'panel-clock', 'panel-wrist', 'side-phrases', 'skin-warm']);
  for (const dir of folders) {
    const m = manifestIn(dir);
    for (const file of [m.page, m.panel?.page, m.window, m.main, m.icon, m.skin, m.layout, 'README.md', 'LICENSE']) {
      if (file !== undefined) assert.ok(fs.existsSync(path.join(dir, file)), `${m.id} 没有 ${file}`);
    }
  }
});

test('示例组件：都能打成 zip 和 npm 包；时钟面板的包里有清单、入口和图标，npm 包的 package.json 标明是带代码的面板组件', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-examples-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  for (const dir of folders) {
    const m = manifestIn(dir);
    const zip = pack(dir, false, out);
    assert.equal(path.basename(zip), `${m.id}.zip`);
    assert.ok(entries(zip).includes('component.json'), m.id);
    const tgz = pack(dir, true, out);
    assert.equal(path.basename(tgz), `foxpanel-component-${m.id.replace('.', '-')}-${m.version}.tgz`);
    assert.ok(entries(tgz).includes('package/component.json'), m.id);
  }
  const files = ['LICENSE', 'README.md', 'component.json', 'icon.svg', 'panel.js'];
  assert.deepEqual(entries(path.join(out, `${CLOCK_ID}.zip`)).sort(), files);
  const tgz = path.join(out, 'foxpanel-component-yanuo-panel-clock-1.0.0.tgz');
  assert.deepEqual(entries(tgz).filter(e => e !== 'package').sort(), [...files, 'package.json'].map(f => `package/${f}`).sort());
  const pkg: unknown = JSON.parse(execFileSync(TAR, ['-xOf', tgz, 'package/package.json'], { encoding: 'utf8' }));
  assert.ok(isObject(pkg));
  assert.deepEqual([pkg['name'], pkg['version'], pkg['type']], ['foxpanel-component-yanuo-panel-clock', '1.0.0', 'module']);
  const summary = parseSummary(pkg['foxpanel']);
  assert.deepEqual([summary?.id, summary?.kind, summary?.code], [CLOCK_ID, 'panel', true]);
});

test('时钟面板的清单：panel 类别，只写了入口、页面宽高和默认宽度，别的用默认值；不要任何服务；两项开关设置', () => {
  const m = manifestIn(CLOCK);
  assert.deepEqual([m.id, m.kind, m.page, m.main, m.window, m.requires, m.uses, m.provides, m.icon], [CLOCK_ID, 'panel', undefined, undefined, undefined, undefined, undefined, undefined, 'icon.svg']);
  assert.deepEqual(m.panel, {
    page: 'panel.js', width: 480, height: 200, scale: 1, fps: 30, meters: 0.3, minMeters: 0.1, maxMeters: 2,
    anchor: 'world', spawn: 'front', glance: false, keep: false, sound: false, slots: [],
  });
  assert.deepEqual(m.settings.map(d => [d.key, d.type, 'default' in d ? d.default : undefined]), [['hour24', 'toggle', true], ['seconds', 'toggle', false]]);
  // 名字和设置项的说明五种界面语言都有
  for (const text of [m.name, ...m.settings.map(d => d.label)]) {
    assert.ok(typeof text === 'object');
    for (const lang of LOCALES) assert.ok(text[lang], lang);
  }
});

test('时钟面板打成的 zip 装得上：面板目录里有它(不是预装的)，计划的根是 panel.js、带设置的值，没有部件和服务，够不着任何远程服务', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-examples-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zip = pack(CLOCK, false, root);
  const store = new ComponentStore({ dir: path.join(root, 'installed'), preinstalled: path.join(root, 'pre'), log: () => undefined });
  const preview = store.stage(zip);
  assert.deepEqual([preview.ok, preview.ok && preview.manifest.id, preview.ok && preview.code], [true, CLOCK_ID, true]);
  store.install();
  store.scan([]);
  assert.deepEqual(store.broken, []);
  const info = store.panelInfos(EMPTY)[0];
  assert.deepEqual(
    [info?.id, info?.width, info?.height, info?.meters, info?.keep, info?.icon],
    [CLOCK_ID, 480, 200, 0.3, false, `fox://component/${CLOCK_ID}/icon.svg`],
  );
  const plan = store.panelPlans({ ...EMPTY, config: { [CLOCK_ID]: { seconds: true } } })[0] ?? assert.fail('没有时钟面板的计划');
  assert.deepEqual([plan.id, plan.size, plan.parts, plan.services, plan.remotes, plan.sound], [CLOCK_ID, { width: 480, height: 200 }, {}, [], [], false]);
  assert.deepEqual([plan.root.id, plan.root.kind, plan.root.config], [CLOCK_ID, 'panel', { hour24: true, seconds: true }]);
  assert.match(plan.root.url, /^fox:\/\/component\/yanuo\.panel-clock\/panel\.js\?t=\d+$/);
});

// ---- 时钟面板的页面代码：用假的元素和假的上下文跑 ----

// 页面代码用到的那一点元素接口
class FakeElement {
  readonly tag: string;
  children: FakeElement[] = [];
  className = '';
  type = '';
  textContent = '';
  ariaLabel: string | null = null;
  readonly style = { cssText: '' };
  private readonly listeners = new Map<string, (() => void)[]>();

  constructor(tag: string) {
    this.tag = tag;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(): void {
    this.children = [];
  }

  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]);
  }

  // 触发一个事件
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

// 插件用到的那一部分上下文
interface ClockContext {
  config: Record<string, unknown>;
  effect(fn: () => () => void): void;
  slot: { el: FakeElement; mount(render: (el: FakeElement) => (() => void) | void): () => void };
  i18n: { readonly locale: Locale; text(t: Text): string };
  panel: { readonly visible: boolean; hide(): void };
}

interface ClockPlugin {
  name: string;
  inject: string[];
  apply(ctx: ClockContext): void;
}

// 一个示例面板的页面代码(panel.js)默认导出的插件
async function loadPanel(dir: string): Promise<ClockPlugin> {
  const mod = await import(pathToFileURL(path.join(dir, 'panel.js')).href) as { default: ClockPlugin };
  return mod.default;
}

const loadClock = (): Promise<ClockPlugin> => loadPanel(CLOCK);

interface Clock {
  root: FakeElement;
  look: { locale: Locale };            // 界面语言(响应式)
  visible: { value: boolean };         // 面板显示着没有(响应式)
  hides: number;                       // 调了几次 ctx.panel.hide
  time(): string;
  date(): string;
  button(): FakeElement;
  dispose(): void;                     // 卸载插件
}

// 在假的上下文里跑时钟的插件；slot 的做法和面板页面宿主的一样(卸载时清空元素)
function mountClock(plugin: ClockPlugin, config: Record<string, unknown>, locale: Locale = 'zh-Hans'): Clock {
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeElement(tag) };
  const root = new FakeElement('div');
  root.className = 'fox-panel fox-theme';
  const look = reactive({ locale });
  const visible = ref(true);
  const disposers: (() => void)[] = [];
  const card = (): FakeElement => root.children[0] ?? assert.fail('面板里没有内容');
  const clock: Clock = {
    root, look, visible, hides: 0,
    time: () => card().children[0]?.textContent ?? '',
    date: () => card().children[1]?.textContent ?? '',
    button: () => card().children.find(c => c.tag === 'button') ?? assert.fail('没有收起按钮'),
    dispose: () => { for (const fn of disposers.splice(0)) fn(); },
  };
  plugin.apply({
    config,
    effect: fn => { disposers.push(fn()); },
    slot: {
      el: root,
      mount: render => {
        const cleanup = render(root);
        return () => {
          cleanup?.();
          root.replaceChildren();
        };
      },
    },
    i18n: { get locale() { return look.locale; }, text: t => textOf(t, look.locale) },
    panel: { get visible() { return visible.value; }, hide: () => { clock.hides++; } },
  });
  return clock;
}

// 2026-01-05(星期一)本地时间 09:05:07
const MORNING = new Date(2026, 0, 5, 9, 5, 7);

test('时钟面板：插件要宿主的 i18n；画一张卡片，按界面语言写时间和日期，每秒走一次；根元素自己的类名不动', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: MORNING });
  const plugin = await loadClock();
  assert.deepEqual([plugin.name, plugin.inject], [CLOCK_ID, ['i18n']]);
  const c = mountClock(plugin, { hour24: true, seconds: false });
  assert.deepEqual([c.root.children.length, c.root.children[0]?.className, c.root.className], [1, 'card', 'fox-panel fox-theme']);
  assert.equal(c.time(), '09:05');
  assert.match(c.date(), /2026/);
  assert.match(c.date(), /星期一/);
  t.mock.timers.tick(52_000);
  assert.equal(c.time(), '09:05');
  t.mock.timers.tick(1000);
  assert.equal(c.time(), '09:06');
  c.dispose();
});

test('时钟面板的设置：显示秒、12 小时制；24 小时制的零点是 00', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: MORNING });
  const plugin = await loadClock();
  const seconds = mountClock(plugin, { hour24: true, seconds: true });
  assert.equal(seconds.time(), '09:05:07');
  t.mock.timers.tick(1000);
  assert.equal(seconds.time(), '09:05:08');
  seconds.dispose();
  const half = mountClock(plugin, { hour24: false, seconds: false }, 'en');
  assert.match(half.time(), /^09:05\sAM$/);
  half.dispose();
  t.mock.timers.setTime(new Date(2026, 0, 6, 0, 5, 0).getTime());
  const midnight = mountClock(plugin, { hour24: true, seconds: false }, 'en');
  assert.equal(midnight.time(), '00:05');
  midnight.dispose();
});

test('时钟面板跟界面语言：换了语言马上重画，日期和收起按钮的说明用新的语言', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: MORNING });
  const c = mountClock(await loadClock(), { hour24: true, seconds: false });
  const zh = [c.date(), c.button().ariaLabel];
  assert.equal(zh[1], '收起');
  c.look.locale = 'en';
  await nextTick();
  assert.match(c.date(), /Monday, January 5, 2026/);
  assert.equal(c.button().ariaLabel, 'Hide');
  // 五种语言的说明都有；换回简体中文时和一开始的一样
  for (const lang of LOCALES) {
    c.look.locale = lang;
    await nextTick();
    assert.ok(c.button().ariaLabel, lang);
  }
  c.look.locale = 'zh-Hans';
  await nextTick();
  assert.deepEqual([c.date(), c.button().ariaLabel], zh);
  c.dispose();
});

test('时钟面板没在显示时停表，重新显示出来马上画；收起按钮调 ctx.panel.hide；卸载后清空元素、表停下', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: MORNING });
  const c = mountClock(await loadClock(), { hour24: true, seconds: true });
  c.visible.value = false;
  await nextTick();
  t.mock.timers.tick(5000);
  assert.equal(c.time(), '09:05:07');
  c.visible.value = true;
  await nextTick();
  assert.equal(c.time(), '09:05:12');
  t.mock.timers.tick(1000);
  assert.equal(c.time(), '09:05:13');

  const button = c.button();
  assert.equal(button.className, 'icon-btn');
  button.fire('mousedown');
  assert.equal(c.hides, 1);

  const time = c.root.children[0]?.children[0] ?? assert.fail('没有时间');
  c.dispose();
  assert.equal(c.root.children.length, 0);
  t.mock.timers.tick(3000);
  assert.equal(time.textContent, '09:05:13');
  // 没在显示时卸载也一样
  const hidden = mountClock(await loadClock(), { hour24: true, seconds: true });
  hidden.visible.value = false;
  await nextTick();
  hidden.dispose();
  assert.equal(hidden.root.children.length, 0);
});

// ---- 手腕时钟 ----

test('手腕时钟的清单：panel 类别，附着在左手上、抬手才显示，页面 240×120、宽 0.12 米，别的用默认值；不要任何服务；一项开关设置', () => {
  const m = manifestIn(WRIST);
  assert.deepEqual([m.id, m.kind, m.page, m.main, m.window, m.requires, m.uses, m.provides, m.icon], [WRIST_ID, 'panel', undefined, undefined, undefined, undefined, undefined, undefined, 'icon.svg']);
  assert.deepEqual(m.panel, {
    page: 'panel.js', width: 240, height: 120, scale: 1, fps: 30, meters: 0.12, minMeters: 0.1, maxMeters: 2,
    anchor: 'left', spawn: 'front', glance: true, keep: false, sound: false, slots: [],
  });
  assert.deepEqual(m.settings.map(d => [d.key, d.type, 'default' in d ? d.default : undefined]), [['hour24', 'toggle', true]]);
  for (const text of [m.name, ...m.settings.map(d => d.label)]) {
    assert.ok(typeof text === 'object');
    for (const lang of LOCALES) assert.ok(text[lang], lang);
  }
});

test('手腕时钟打成的 zip 和 npm 包里有清单、入口、图标、说明和许可证；装得上，面板目录里它附着在左手上、抬手才显示', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-examples-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = ['LICENSE', 'README.md', 'component.json', 'icon.svg', 'panel.js'];
  const zip = pack(WRIST, false, root);
  assert.deepEqual(entries(zip).sort(), files);
  const tgz = pack(WRIST, true, root);
  assert.equal(path.basename(tgz), 'foxpanel-component-yanuo-panel-wrist-1.0.0.tgz');
  assert.deepEqual(entries(tgz).filter(e => e !== 'package').sort(), [...files, 'package.json'].map(f => `package/${f}`).sort());
  const pkg: unknown = JSON.parse(execFileSync(TAR, ['-xOf', tgz, 'package/package.json'], { encoding: 'utf8' }));
  assert.ok(isObject(pkg));
  const summary = parseSummary(pkg['foxpanel']);
  assert.deepEqual([summary?.id, summary?.kind, summary?.code], [WRIST_ID, 'panel', true]);

  const store = new ComponentStore({ dir: path.join(root, 'installed'), preinstalled: path.join(root, 'pre'), log: () => undefined });
  const preview = store.stage(zip);
  assert.deepEqual([preview.ok, preview.ok && preview.manifest.id, preview.ok && preview.code], [true, WRIST_ID, true]);
  store.install();
  store.scan([]);
  assert.deepEqual(store.broken, []);
  const info = store.panelInfos(EMPTY)[0];
  assert.deepEqual(
    [info?.id, info?.width, info?.height, info?.meters, info?.minMeters, info?.maxMeters, info?.anchor, info?.glance, info?.keep],
    [WRIST_ID, 240, 120, 0.12, 0.1, 2, 'left', true, false],
  );
  const plan = store.panelPlans(EMPTY)[0] ?? assert.fail('没有手腕时钟的计划');
  assert.deepEqual([plan.id, plan.size, plan.parts, plan.services, plan.remotes, plan.root.config], [WRIST_ID, { width: 240, height: 120 }, {}, [], [], { hour24: true }]);
});

test('手腕时钟的页面代码：一张卡片里只有时间和日期，没有按钮；按界面语言写，每秒走一次；12 小时制；页面停画时停表，卸载后清空元素', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: MORNING });
  const plugin = await loadPanel(WRIST);
  assert.deepEqual([plugin.name, plugin.inject], [WRIST_ID, ['i18n']]);
  const c = mountClock(plugin, { hour24: true });
  const card = c.root.children[0] ?? assert.fail('面板里没有内容');
  assert.deepEqual([c.root.children.length, card.className, card.children.map(e => e.tag), c.root.className], [1, 'card', ['div', 'div'], 'fox-panel fox-theme']);
  assert.equal(c.time(), '09:05');
  assert.match(c.date(), /1月5日/);
  t.mock.timers.tick(53_000);
  assert.equal(c.time(), '09:06');
  c.look.locale = 'en';
  await nextTick();
  assert.match(c.date(), /Jan 5/);
  assert.match(c.date(), /Mon/);
  // 页面停画：停表；恢复时马上画
  c.visible.value = false;
  await nextTick();
  t.mock.timers.tick(120_000);
  assert.equal(c.time(), '09:06');
  c.visible.value = true;
  await nextTick();
  assert.equal(c.time(), '09:08');
  const time = card.children[0] ?? assert.fail('没有时间');
  c.dispose();
  assert.equal(c.root.children.length, 0);
  t.mock.timers.tick(120_000);
  assert.equal(time.textContent, '09:08');

  const half = mountClock(plugin, { hour24: false }, 'en');
  assert.match(half.time(), /^09:10\sAM$/);
  half.dispose();
});
