import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ComponentStore, hasCode, insideDir, TAR } from '../src/main/components/store.ts';
import { applyPatch, checkValue, readComponents, readPreinstalled } from '../src/main/components/settings.ts';
import type { ComponentSettings } from '../src/shared/types.ts';
import type { SettingDef } from '../src/shared/manifest.ts';

const EMPTY: ComponentSettings = { order: [], off: [], config: {}, removed: [], dev: [], devMode: false, groups: [], folded: [], names: {}, market: { registry: 'https://registry.npmmirror.com', scripts: false } };

// 设置项的简写 { key, type, label, … } → config 里的 Schema 节点
type Field = { key: string; type: string; label: string; [k: string]: unknown };
type Opt = { value: string; label: string };
function node(f: Field): object {
  const { key: _key, type, label, ...rest } = f;
  const meta: Record<string, unknown> = { description: label, ...rest };
  switch (type) {
    case 'toggle': return { type: 'boolean', meta };
    case 'number': return { type: 'number', meta };
    case 'text': return { type: 'string', meta };
    case 'secret': return { type: 'string', meta: { ...meta, role: 'secret' } };
    case 'select': {
      const { options, ...m } = meta;
      return { type: 'union', list: (options as Opt[]).map(o => ({ type: 'const', value: o.value, meta: { description: o.label } })), meta: m };
    }
    case 'list': {
      const { fields, ...m } = meta;
      return { type: 'array', inner: { type: 'object', dict: Object.fromEntries((fields as { key: string; label: string }[]).map(x => [x.key, { type: 'string', meta: { description: x.label } }])) }, meta: m };
    }
    default: throw new Error(type);
  }
}

function component(root: string, id: string, extra: Record<string, unknown> = {}): void {
  const kind = extra['kind'] ?? 'sidepage';
  const fields = extra['fields'] as Field[] | undefined;
  if (fields) {
    delete extra['fields'];
    extra['config'] = { type: 'object', dict: Object.fromEntries(fields.map(f => [f.key, node(f)])) };
  }
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify({
    id, kind, name: id, version: '1.0.0', author: 'test', license: 'MIT', page: 'page.js', ...extra,
  }));
  fs.writeFileSync(path.join(dir, 'page.js'), `// ${id}`);
}

function setup(): { root: string; pre: string; store: ComponentStore; logs: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-comp-'));
  const pre = path.join(root, 'pre');
  const logs: string[] = [];
  const store = new ComponentStore({ dir: path.join(root, 'installed'), preinstalled: pre, log: t => logs.push(t) });
  return { root, pre, store, logs };
}

test('预装：首次复制并按清单顺序返回；版本不变不重复复制，版本更新时覆盖', () => {
  const { root, pre, store } = setup();
  component(pre, 'yanuo.b');
  component(pre, 'yanuo.a');
  fs.writeFileSync(path.join(pre, 'preinstalled.json'), JSON.stringify(['yanuo.b', 'yanuo.a']));
  assert.deepEqual(store.syncPreinstalled([]), ['yanuo.b', 'yanuo.a']);
  assert.deepEqual(store.syncPreinstalled([]), []);
  // 分组写法：顶层的 id 和分组里的 id 都算预装，分组照写的顺序
  fs.writeFileSync(path.join(pre, 'preinstalled.json'), JSON.stringify([{ group: 'basic', ids: ['yanuo.b'] }, 'yanuo.a', { group: 'BAD!', ids: [] }]));
  assert.deepEqual(readPreinstalled(pre), { ids: ['yanuo.b', 'yanuo.a'], groups: [{ id: 'basic', name: 'basic', ids: ['yanuo.b'] }] });
  component(pre, 'yanuo.a', { version: '1.1.0' });
  assert.deepEqual(store.syncPreinstalled([]), []);
  store.scan([]);
  assert.equal(store.all.find(c => c.manifest.id === 'yanuo.a')?.manifest.version, '1.1.0');
  fs.rmSync(root, { recursive: true, force: true });
});

test('扫描：清单有误或文件夹名和 id 不一致的跳过', () => {
  const { root, store, logs } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'yanuo.ok');
  component(dir, 'yanuo.bad', { version: 'x' });
  fs.mkdirSync(path.join(dir, 'other'));
  fs.cpSync(path.join(dir, 'yanuo.ok', 'component.json'), path.join(dir, 'other', 'component.json'));
  store.scan([]);
  assert.deepEqual(store.all.map(c => c.manifest.id), ['yanuo.ok']);
  assert.equal(logs.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('扫描：算带不带代码时有子文件夹读不了的组件列进 broken，别的组件照常加载', t => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'yanuo.ok');
  // 没有入口的皮肤：带不带代码要看包里有没有 Lua 脚本
  component(dir, 'yanuo.locked', { kind: 'skin', page: undefined, skin: 'skin.css' });
  const locked = path.join(dir, 'yanuo.locked', 'sub');
  fs.mkdirSync(locked);
  const readdir = fs.readdirSync.bind(fs) as (...args: unknown[]) => unknown;
  const mock = t.mock.method(fs, 'readdirSync', (...args: unknown[]) => {
    if (args[0] === locked) throw new Error(`EPERM: operation not permitted, scandir '${locked}'`);
    return readdir(...args);
  });
  store.scan([]);
  mock.mock.restore();
  assert.deepEqual(store.all.map(c => c.manifest.id), ['yanuo.ok']);
  assert.deepEqual(store.broken.map(b => b.name), ['yanuo.locked']);
  assert.match(store.broken[0]?.errors.join() ?? '', /^读不了组件文件夹：EPERM/);
  // 子文件夹能读时照常加载
  store.scan([]);
  assert.deepEqual([store.get('yanuo.locked')?.code, store.broken.length], [false, 0]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('开关和顺序：关掉的不加载；只能开一个的类别取最前面的；面板可以开好几块', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'yanuo.cand-a', { kind: 'candidates' });
  component(dir, 'yanuo.cand-b', { kind: 'candidates' });
  component(dir, 'yanuo.quick');
  component(dir, 'yanuo.numpad');
  component(dir, 'yanuo.kb-a', { kind: 'panel', page: undefined, panel: { page: 'page.js', width: 1400, height: 490 } });
  component(dir, 'yanuo.kb-b', { kind: 'panel', page: undefined, panel: { page: 'page.js', width: 800, height: 300 } });
  store.scan([]);
  const ids = (x: ComponentSettings): string[] => store.active(x).map(c => c.manifest.id);
  const s = { ...EMPTY, order: ['yanuo.cand-b', 'yanuo.cand-a', 'yanuo.quick', 'yanuo.numpad', 'yanuo.kb-b', 'yanuo.kb-a'] };
  assert.deepEqual(ids(s), ['yanuo.cand-b', 'yanuo.quick', 'yanuo.numpad', 'yanuo.kb-b', 'yanuo.kb-a']);
  const off = { ...s, off: ['yanuo.cand-b', 'yanuo.quick', 'yanuo.kb-b'] };
  assert.deepEqual(ids(off), ['yanuo.cand-a', 'yanuo.numpad', 'yanuo.kb-a']);
  assert.deepEqual(ids({ ...s, off: ['yanuo.cand-a', 'yanuo.cand-b'] }), ['yanuo.quick', 'yanuo.numpad', 'yanuo.kb-b', 'yanuo.kb-a']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('文件路径不越出组件目录', () => {
  const { root, store } = setup();
  component(path.join(root, 'installed'), 'yanuo.x');
  store.scan([]);
  assert.ok(store.resolve('yanuo.x', 'page.js')?.endsWith('page.js'));
  assert.equal(store.resolve('yanuo.x', '../yanuo.y/page.js'), null);
  assert.equal(store.resolve('yanuo.x', '../../secret.txt'), null);
  assert.equal(store.resolve('yanuo.none', 'page.js'), null);
  assert.equal(insideDir(root, 'a/b.js'), path.join(root, 'a', 'b.js'));
  assert.equal(insideDir(root, '../x.js'), null);
  assert.equal(insideDir(root, ''), null);
  fs.rmSync(root, { recursive: true, force: true });
});

// 把 dir 打成 zip；inner = 包里多套一层文件夹
function zip(dir: string, out: string, inner = false): string {
  execFileSync(TAR, ['-a', '-cf', out, '-C', inner ? path.dirname(dir) : dir, inner ? path.basename(dir) : '.'], { windowsHide: true });
  return out;
}

test('安装 zip：清单在最外层或唯一子文件夹；同 id 替换；入口文件要在包里；带代码标记', () => {
  const { root, store } = setup();
  const src = path.join(root, 'src');
  component(src, 'test.a');
  const r1 = store.stage(zip(path.join(src, 'test.a'), path.join(root, 'a.zip')));
  assert.ok(r1.ok);
  assert.equal(r1.code, true);
  assert.equal(r1.replaces, null);
  store.install();
  component(src, 'test.a', { version: '1.2.0' });
  const r2 = store.stage(zip(path.join(src, 'test.a'), path.join(root, 'a2.zip'), true));
  assert.ok(r2.ok && r2.replaces === '1.0.0');
  store.install();
  store.scan([]);
  assert.equal(store.all[0]?.manifest.version, '1.2.0');
  fs.rmSync(path.join(src, 'test.a', 'page.js'));
  const r3 = store.stage(zip(path.join(src, 'test.a'), path.join(root, 'a3.zip')));
  assert.ok(!r3.ok && 'error' in r3 && r3.error.includes('page.js'));
  assert.ok(!fs.existsSync(path.join(root, 'installed', '.staging')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('带代码：page / window / main 入口或包里的 Lua 脚本；只有主窗口入口的也算，入口文件要在包里', () => {
  const { root, store } = setup();
  const src = path.join(root, 'src');
  const skin = { kind: 'skin', skin: 'skin.css', page: undefined };
  component(src, 'test.data', skin);
  component(src, 'test.win', { ...skin, window: 'window.js' });
  for (const id of ['test.data', 'test.win']) fs.writeFileSync(path.join(src, id, 'skin.css'), '');
  const data = ComponentStore.read(path.join(src, 'test.data'));
  const win = ComponentStore.read(path.join(src, 'test.win'));
  assert.ok(data.ok && win.ok);
  assert.equal(hasCode(data.manifest, path.join(src, 'test.data')), false);
  assert.equal(hasCode(win.manifest, path.join(src, 'test.win')), true);
  // Lua 脚本：only 给了时最外层只看这些名字
  fs.mkdirSync(path.join(src, 'test.data', 'src'));
  fs.writeFileSync(path.join(src, 'test.data', 'src', 'x.lua'), '');
  assert.equal(hasCode(data.manifest, path.join(src, 'test.data')), true);
  assert.equal(hasCode(data.manifest, path.join(src, 'test.data'), ['component.json', 'skin.css']), false);
  assert.equal(hasCode(data.manifest, path.join(src, 'test.data'), ['src']), true);
  // 扫描时算好，列表里直接用
  store.scan([path.join(src, 'test.data'), path.join(src, 'test.win')]);
  assert.deepEqual(store.rows(EMPTY, () => false).map(r => [r.id, r.code]), [['test.data', true], ['test.win', true]]);
  fs.rmSync(path.join(src, 'test.data', 'src'), { recursive: true });
  store.scan([path.join(src, 'test.data')]);
  assert.equal(store.get('test.data')?.code, false);
  // 主窗口入口文件不在包里：安装预览报错；在包里时标成带代码
  const missing = store.stage(zip(path.join(src, 'test.win'), path.join(root, 'w.zip')));
  assert.ok(!missing.ok && 'error' in missing && missing.error.includes('window.js'));
  fs.writeFileSync(path.join(src, 'test.win', 'window.js'), '');
  const ok = store.stage(zip(path.join(src, 'test.win'), path.join(root, 'w2.zip')));
  assert.ok(ok.ok && ok.code);
  store.discard();
  fs.rmSync(root, { recursive: true, force: true });
});

test('卸载过的预装组件同步时不装回', () => {
  const { root, pre, store } = setup();
  component(pre, 'yanuo.a');
  component(pre, 'yanuo.b');
  fs.writeFileSync(path.join(pre, 'preinstalled.json'), JSON.stringify(['yanuo.a', 'yanuo.b']));
  store.syncPreinstalled([]);
  store.scan([]);
  store.remove('yanuo.a');
  assert.deepEqual(store.syncPreinstalled(['yanuo.a']), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('卸载：id 不是「作者.名字」格式的不拼成路径，组件目录外和 node_modules 里的文件夹不动', () => {
  const { root, store } = setup();
  const installed = path.join(root, 'installed');
  component(installed, 'test.x');
  component(root, 'outside');
  component(path.join(installed, 'node_modules'), 'foxpanel-component-x', { id: 'test.pkg' });
  store.scan([], { 'foxpanel-component-x': '1.0.0' });
  assert.equal(store.get('test.x')?.manifest.id, 'test.x');
  assert.equal(store.get('test.none'), undefined);
  for (const id of ['../outside', 'node_modules/foxpanel-component-x', 'node_modules\foxpanel-component-x', '.', '']) {
    assert.throws(() => store.remove(id), /没有这个组件/, id);
  }
  assert.ok(fs.existsSync(path.join(root, 'outside', 'component.json')));
  assert.ok(fs.existsSync(path.join(installed, 'node_modules', 'foxpanel-component-x', 'component.json')));
  assert.throws(() => store.remove('test.none'), /没有这个组件/);
  store.remove('test.x');
  assert.ok(!fs.existsSync(path.join(installed, 'test.x')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('开发文件夹：同 id 优先于已装的，文件指向开发文件夹；坏清单列进 broken', () => {
  const { root, store } = setup();
  component(path.join(root, 'installed'), 'test.x');
  component(path.join(root, 'work'), 'test.x', { version: '2.0.0' });
  component(path.join(root, 'work'), 'bad', { kind: 'nope' });
  store.scan([path.join(root, 'work', 'test.x'), path.join(root, 'work', 'bad')]);
  assert.equal(store.all.length, 1);
  assert.equal(store.all[0]?.dev, true);
  assert.equal(store.all[0]?.manifest.version, '2.0.0');
  assert.ok(store.resolve('test.x', 'page.js')?.startsWith(path.join(root, 'work')));
  assert.equal(store.broken[0]?.dev, true);
  store.scan([]);
  assert.equal(store.all[0]?.dev, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('npm 装的组件：读 node_modules/<包名>，同 id 时优先于文件夹；node_modules 本身不当组件；坏清单列进 broken', () => {
  const { root, store } = setup();
  const installed = path.join(root, 'installed');
  component(installed, 'test.x');
  component(path.join(installed, 'node_modules', '@me'), 'foxpanel-component-x', { id: 'test.x', version: '3.0.0' });
  component(path.join(installed, 'node_modules'), 'foxpanel-component-bad', { id: 'test.bad', kind: 'nope' });
  store.scan([], { '@me/foxpanel-component-x': '3.0.0', 'foxpanel-component-bad': '1.0.0' });
  assert.deepEqual(store.all.map(c => [c.manifest.id, c.manifest.version, c.npm]), [['test.x', '3.0.0', '@me/foxpanel-component-x']]);
  assert.deepEqual(store.broken.map(b => b.name), ['foxpanel-component-bad']);
  store.scan([]);
  assert.deepEqual(store.all.map(c => [c.manifest.version, c.npm]), [['1.0.0', undefined]]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('改动：选用单选类别、同类排序、设置值校验和夹紧', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'yanuo.cand-a', { kind: 'candidates' });
  component(dir, 'yanuo.cand-b', { kind: 'candidates' });
  component(dir, 'yanuo.p1', { fields: [{ key: 'n', type: 'number', label: 'n', default: 1, min: 0, max: 10 }, { key: 'k', type: 'secret', label: 'k' }] });
  component(dir, 'yanuo.p2');
  store.scan([]);
  let s: ComponentSettings = { ...EMPTY, order: ['yanuo.cand-a', 'yanuo.p1', 'yanuo.cand-b', 'yanuo.p2'], off: ['yanuo.cand-b'] };
  s = applyPatch(s, { kind: 'use', id: 'yanuo.cand-b' }, store.all);
  assert.deepEqual(s.order, ['yanuo.cand-b', 'yanuo.cand-a', 'yanuo.p1', 'yanuo.p2']);
  assert.deepEqual(store.active(s).filter(c => c.manifest.kind === 'candidates').map(c => c.manifest.id), ['yanuo.cand-b']);
  s = applyPatch(s, { kind: 'order', ids: ['yanuo.p2', 'yanuo.p1'] }, store.all);
  assert.deepEqual(s.order, ['yanuo.cand-b', 'yanuo.cand-a', 'yanuo.p2', 'yanuo.p1']);
  s = applyPatch(s, { kind: 'configs', id: 'yanuo.p1', values: { n: 99 } }, store.all);
  assert.equal(store.rows(s, () => false).find(r => r.id === 'yanuo.p1')?.config['n'], 10);
  assert.throws(() => applyPatch(s, { kind: 'configs', id: 'yanuo.p1', values: { n: 'x' } }, store.all));
  assert.throws(() => applyPatch(s, { kind: 'configs', id: 'yanuo.p1', values: { k: 'secret' } }, store.all));
  assert.throws(() => applyPatch(s, { kind: 'use', id: 'yanuo.p1' }, store.all));
  const row = store.rows(s, (id, key) => id === 'yanuo.p1' && key === 'k').find(r => r.id === 'yanuo.p1');
  assert.deepEqual(row?.secrets, { k: true });
  assert.equal(row?.active, true);
  assert.equal(store.rows(s, () => false).find(r => r.id === 'yanuo.cand-a')?.active, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('数据组件：布局 JSON 读进来给有 layout 插槽的面板，不是 JSON 的列进 broken；皮肤地址；语言可以全关；皮肤可以都不用', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  const data = (id: string, extra: Record<string, unknown>, files: Record<string, string> = {}): void => {
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, 'component.json'), JSON.stringify({ id, name: id, version: '1.0.0', author: 'a', license: 'MIT', ...extra }));
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, id, f), text);
  };
  data('t.ru', { kind: 'layout', layout: 'layout.json' }, { 'layout.json': JSON.stringify({ rows: [[{ id: 'a', text: ['й', 'Й'] }]] }) });
  data('t.bad', { kind: 'layout', layout: 'layout.json' }, { 'layout.json': '{ rows: ' });
  data('t.skin', { kind: 'skin', skin: 'skin.css' }, { 'skin.css': '' });
  data('t.zh', { kind: 'lang', ime: { schema: 'clover' } });
  data('t.en', { kind: 'lang', ime: { schema: 'easy_en' } });
  data('t.kb', { kind: 'panel', panel: { page: 'panel.js', width: 100, height: 100, slots: ['layout'] } }, { 'panel.js': '' });
  store.scan([]);
  let s: ComponentSettings = { ...EMPTY };
  assert.deepEqual(store.panelPlans(s)[0]?.parts, { layout: [{ id: 't.ru', kind: 'layout', name: 't.ru', config: {}, layout: { rows: [[{ id: 'a', text: ['й', 'Й'] }]] } }] });
  assert.equal(store.broken[0]?.name, 't.bad');
  assert.match(store.panelPlans(s)[0]?.skin ?? '', /^fox:\/\/component\/t\.skin\/skin\.css\?t=\d+$/);
  s = applyPatch(s, { kind: 'none', of: 'skin' }, store.all);
  assert.equal(store.panelPlans(s)[0]?.skin, null);
  assert.ok(store.active(applyPatch(s, { kind: 'none', of: 'layout' }, store.all)).every(c => c.manifest.kind !== 'layout'));
  s = applyPatch(s, { kind: 'on', id: 't.zh', on: false }, store.all);
  s = applyPatch(s, { kind: 'on', id: 't.en', on: false }, store.all);
  assert.ok(s.off.includes('t.zh') && s.off.includes('t.en'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('翻译组件：可以都不用；共用 secret 存在 share 下；新设置项的值检查', async () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 't.mt', { kind: 'translator', page: undefined, main: 'main.js', fields: [
    { key: 'apiKey', type: 'secret', label: 'k', share: 'bailian' },
    { key: 'model', type: 'select', label: 'm', default: 'a', custom: true, options: [{ value: 'a', label: 'a' }] },
    { key: 'rows', type: 'list', label: 'r', fields: [{ key: 'id', label: 'id' }], default: [] },
  ] });
  fs.writeFileSync(path.join(dir, 't.mt', 'main.js'), '');
  store.scan([]);
  let s: ComponentSettings = { ...EMPTY };
  assert.equal(store.mainComponents(s)[0]?.id, 't.mt');
  assert.equal(store.mainComponents(s)[0]?.mtime, fs.statSync(path.join(dir, 't.mt', 'main.js')).mtimeMs);
  assert.deepEqual(store.mainComponents(s)[0]?.secrets, [{ key: 'apiKey', at: ['share:bailian', 'value'] }]);
  s = applyPatch(s, { kind: 'configs', id: 't.mt', values: { model: 'qwen-mt-plus' } }, store.all);
  s = applyPatch(s, { kind: 'configs', id: 't.mt', values: { rows: [{ id: 'x', extra: 1 }, 'bad'] } }, store.all);
  assert.deepEqual(store.rows(s, () => false)[0]?.config, { model: 'qwen-mt-plus', rows: [{ id: 'x' }] });
  const ports: SettingDef = { key: 'p', label: 'p', type: 'tags', item: 'number', default: [], min: 1, max: 65535 };
  assert.deepEqual(checkValue(ports, [9000, 9000, 0, '9001', 70000, 9002]), [9000, 9002]);
  assert.equal(checkValue(ports, 'x'), undefined);
  s = applyPatch(s, { kind: 'none', of: 'translator' }, store.all);
  assert.equal(store.mainComponents(s).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('分组和名字：自建分组去重、一个组件只在一个分组；折叠；分组顺序去重；重命名和清除；一次保存几项设置', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'yanuo.p1', { fields: [{ key: 'n', type: 'number', label: 'n', default: 1, min: 0, max: 10 }, { key: 'b', type: 'toggle', label: 'b', default: false }] });
  component(dir, 'yanuo.p2');
  store.scan([]);
  let s: ComponentSettings = { ...EMPTY, order: ['yanuo.p1', 'yanuo.p2'] };
  s = applyPatch(s, { kind: 'groups', groups: [{ id: 'a', name: ' 常用 ', ids: ['yanuo.p1', 'yanuo.p2'] }, { id: 'a', name: '重复', ids: [] }, { id: 'b', name: '', ids: [] }, { id: 'c', name: '第二', ids: ['yanuo.p1'] }] }, store.all);
  assert.deepEqual(s.groups, [{ id: 'a', name: '常用', ids: ['yanuo.p1', 'yanuo.p2'] }, { id: 'c', name: '第二', ids: [] }]);
  s = applyPatch(s, { kind: 'fold', key: 'u:a', folded: true }, store.all);
  s = applyPatch(s, { kind: 'fold', key: 'u:a', folded: true }, store.all);
  assert.deepEqual(s.folded, ['u:a']);
  s = applyPatch(s, { kind: 'fold', key: 'u:a', folded: false }, store.all);
  assert.deepEqual(s.folded, []);
  s = applyPatch(s, { kind: 'name', id: 'yanuo.p1', name: '  我的  ' }, store.all);
  assert.deepEqual(s.names, { 'yanuo.p1': '我的' });
  s = applyPatch(s, { kind: 'name', id: 'yanuo.p1', name: '' }, store.all);
  assert.deepEqual(s.names, {});
  assert.throws(() => applyPatch(s, { kind: 'name', id: 'yanuo.none', name: 'x' }, store.all));
  s = applyPatch(s, { kind: 'configs', id: 'yanuo.p1', values: { n: 20, b: true } }, store.all);
  assert.deepEqual(s.config['yanuo.p1'], { n: 10, b: true });
  assert.throws(() => applyPatch(s, { kind: 'configs', id: 'yanuo.p1', values: { n: 1, b: 'x' } }, store.all));
  fs.rmSync(root, { recursive: true, force: true });
});

test('服务：要的服务没有开着的提供者时不加载；主进程组件拿到服务的设置和 secret，自己的同名项优先', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'yanuo.cloud', {
    kind: 'service', page: undefined, provides: ['cloud'],
    fields: [{ key: 'apiKey', type: 'secret', label: 'k', share: 'cloud' }, { key: 'domain', type: 'text', label: 'd', default: 'a.com' }, { key: 'x', type: 'text', label: 'x', default: 'svc' }],
  });
  component(dir, 'yanuo.out', { kind: 'output', page: undefined, main: 'page.js', requires: ['cloud'], fields: [{ key: 'x', type: 'text', label: 'x', default: 'own' }] });
  store.scan([]);
  let s: ComponentSettings = { ...EMPTY, order: ['yanuo.cloud', 'yanuo.out'] };
  assert.deepEqual(store.active(s).map(c => c.manifest.id), ['yanuo.cloud', 'yanuo.out']);
  const [main] = store.mainComponents(s);
  assert.deepEqual(main?.config, { domain: 'a.com', x: 'own' });
  assert.deepEqual(main?.secrets, [{ key: 'apiKey', at: ['share:cloud', 'value'] }]);
  assert.deepEqual(store.rows(s, () => false).find(r => r.id === 'yanuo.out')?.requires, [{ name: 'cloud', id: 'yanuo.cloud', on: true }]);
  s = { ...s, off: ['yanuo.cloud'] };
  assert.deepEqual(store.active(s).map(c => c.manifest.id), []);
  assert.equal(store.rows(s, () => false).find(r => r.id === 'yanuo.out')?.requires?.[0]?.on, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('服务：提供者自己缺服务不算在用时，要它的组件也不算；必需服务一栏按提供者在不在用', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'a.ime', { kind: 'service', provides: ['keyboard'] });
  component(dir, 'a.keys', { kind: 'service', provides: ['keys'], requires: ['keyboard'] });
  component(dir, 'a.d68', { kind: 'layout', requires: ['keys'] });
  component(dir, 'a.deep', { requires: ['d68-extra'] });
  component(dir, 'a.extra', { kind: 'service', provides: ['d68-extra'], requires: ['keys', 'keyboard'] });
  component(dir, 'a.shell', { kind: 'panel', page: undefined, panel: { page: 'page.js', width: 100, height: 64, slots: ['layout', 'sidepage'] } });
  component(dir, 'a.self', { kind: 'service', provides: ['self'], requires: ['self'] });
  store.scan([]);
  const s: ComponentSettings = { ...EMPTY, order: ['a.d68', 'a.deep', 'a.extra', 'a.keys', 'a.ime', 'a.shell', 'a.self'] };
  const ids = (x: ComponentSettings): string[] => store.active(x).map(c => c.manifest.id);
  const needs = (x: ComponentSettings, id: string): unknown => store.rows(x, () => false).find(r => r.id === id)?.requires;
  assert.deepEqual(ids(s), s.order);
  assert.deepEqual(needs(s, 'a.d68'), [{ name: 'keys', id: 'a.keys', on: true }]);

  // 关掉最底下的提供者：一层层要它的都不算，和它无关的照常；面板还在，插槽里没有部件，也不带服务
  const off = { ...s, off: ['a.ime'] };
  assert.deepEqual(ids(off), ['a.shell', 'a.self']);
  assert.deepEqual(store.panelPlans(off).map(p => [p.id, p.parts, p.services]), [['a.shell', { layout: [], sidepage: [] }, []]]);
  assert.deepEqual(needs(off, 'a.keys'), [{ name: 'keyboard', id: 'a.ime', on: false }]);
  assert.deepEqual(needs(off, 'a.d68'), [{ name: 'keys', id: 'a.keys', on: false }]);
  assert.deepEqual(needs(off, 'a.deep'), [{ name: 'd68-extra', id: 'a.extra', on: false }]);

  // 中间一层关掉：下面的提供者还在用，上面要它的不算
  const mid = { ...s, off: ['a.keys'] };
  assert.deepEqual(ids(mid), ['a.ime', 'a.shell', 'a.self']);
  assert.deepEqual(store.providers('keys', mid), []);
  assert.deepEqual(store.providers('keyboard', mid), ['a.ime']);

  // 同名的提供者有两个：排前面的缺服务不算时，必需服务一栏指到在用的那个
  component(dir, 'b.keys', { kind: 'service', provides: ['keys'] });
  store.scan([]);
  const two = { ...off, order: [...off.order, 'b.keys'] };
  assert.deepEqual(ids(two), ['a.d68', 'a.shell', 'a.self', 'b.keys']);
  assert.deepEqual(needs(two, 'a.d68'), [{ name: 'keys', id: 'b.keys', on: true }]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('远程服务的提供者：开着的组件里清单 provides 有这个名字的，按设置顺序；关着的、要的服务没开的不算', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'a.vr', { kind: 'service', page: undefined, main: 'page.js', provides: ['panels'] });
  component(dir, 'b.desk', { kind: 'service', page: undefined, main: 'page.js', provides: ['panels', 'desk'] });
  component(dir, 'c.needy', { kind: 'service', page: undefined, main: 'page.js', provides: ['panels'], requires: ['cloud'] });
  component(dir, 'd.side', {});
  store.scan([]);
  let s: ComponentSettings = { ...EMPTY, order: ['a.vr', 'b.desk', 'c.needy', 'd.side'] };
  assert.deepEqual(store.providers('panels', s), ['a.vr', 'b.desk']);
  assert.deepEqual([store.providers('desk', s), store.providers('cloud', s), store.providers('d.side', s)], [['b.desk'], [], []]);
  // 顺序换了跟着换；排最前的关掉后，后面那个排最前
  s = { ...s, order: ['b.desk', 'a.vr', 'c.needy', 'd.side'] };
  assert.deepEqual(store.providers('panels', s), ['b.desk', 'a.vr']);
  s = { ...s, off: ['b.desk'] };
  assert.deepEqual([store.providers('panels', s), store.providers('desk', s)], [['a.vr'], []]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('一页够得着的远程服务：这一页加载的组件清单 requires 和 uses 里的名字合在一起；uses 不影响组件算不算开着', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'a.ime', { kind: 'service', provides: ['keyboard'] });
  component(dir, 'a.keys', { kind: 'service', provides: ['keys'], requires: ['keyboard'] });
  component(dir, 'a.d68', { kind: 'layout', requires: ['keys'] });
  component(dir, 'a.side', { uses: ['keyboard', 'panels'] });
  component(dir, 'a.plain', {});
  component(dir, 'a.asr', { kind: 'input', page: 'page.js', main: 'page.js', uses: ['keyboard'], requires: ['keys'] });
  store.scan([]);
  const s: ComponentSettings = { ...EMPTY, order: ['a.ime', 'a.keys', 'a.d68', 'a.side', 'a.plain', 'a.asr'] };
  // 一页加载的组件各自写的名字，重复的只留一个；没写的组件不带来名字
  const page = ['a.ime', 'a.keys', 'a.d68', 'a.side', 'a.plain'];
  assert.deepEqual(store.remotesOf(page), ['keyboard', 'keys', 'panels']);
  assert.deepEqual([store.remotesOf(['a.plain']), store.remotesOf([]), store.remotesOf(['a.none'])], [[], [], []]);
  // 媒体页面按自己加载的组件(页面代码和它们要的服务的页面部分)算，不带上别的页面的
  const media = store.mediaPlan(s);
  assert.deepEqual([media.components.map(c => c.id), media.services.map(c => c.id), media.remotes], [['a.asr'], ['a.ime', 'a.keys'], ['keys', 'keyboard']]);
  // uses 里的服务没有提供者：组件照常开着(requires 的没有时才不算)
  assert.ok(store.active(s).some(c => c.manifest.id === 'a.side'));
  const off = { ...s, off: ['a.ime'] };
  const left = store.active(off).map(c => c.manifest.id);
  assert.deepEqual([left.includes('a.keys'), left.includes('a.side'), left.includes('a.plain')], [false, true, true]);
  assert.deepEqual(store.remotesOf(['a.side', 'a.plain']), ['keyboard', 'panels']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('应用信息里的组件：装着的全部，按设置顺序，带目录、清单、开关和是否正在用', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'a.out', { kind: 'output', page: undefined, main: 'page.js', requires: ['cloud'] });
  component(dir, 'a.cloud', { kind: 'service', page: undefined, provides: ['cloud'] });
  component(dir, 'a.zh', { kind: 'lang', page: undefined, ime: { short: '中' } });
  component(dir, 'a.skin', { kind: 'skin', page: undefined, skin: 'page.js' });
  component(dir, 'b.skin', { kind: 'skin', page: undefined, skin: 'page.js' });
  store.scan([]);
  const s: ComponentSettings = { ...EMPTY, order: ['a.zh', 'a.out', 'b.skin', 'a.skin', 'a.cloud'], off: ['a.cloud'] };
  const list = store.appComponents(s);
  assert.deepEqual(list.map(c => [c.id, c.kind, c.on, c.active]), [
    ['a.zh', 'lang', true, true],
    ['a.out', 'output', true, false],       // 要的服务关着
    ['b.skin', 'skin', true, true],
    ['a.skin', 'skin', true, false],        // 只能开一个的类别里排在后面
    ['a.cloud', 'service', false, false],
  ]);
  const zh = list[0];
  assert.deepEqual([zh?.dir, zh?.name, zh?.manifest.ime, zh?.manifest.id], [path.join(dir, 'a.zh'), 'a.zh', { short: '中' }, 'a.zh']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('配置文件里的组件设置：缺的项用默认值，格式不对的项丢掉；没有 groups 时用预装列表的分组', () => {
  const pre = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-pre-'));
  fs.writeFileSync(path.join(pre, 'preinstalled.json'), JSON.stringify([{ group: 'basic', ids: ['yanuo.a'] }]));
  assert.deepEqual(readComponents(undefined, pre), { ...EMPTY, groups: [{ id: 'basic', name: 'basic', ids: ['yanuo.a'] }] });
  assert.deepEqual(readComponents([], pre).order, []);
  const s = readComponents({
    order: ['yanuo.a', 1], off: 'x', devMode: 1, groups: [], folded: ['u:a', null],
    config: { 'yanuo.a': { n: 1 }, 'yanuo.b': 5, 'yanuo.c': 'x', 'yanuo.d': [1], 'yanuo.e': null },
    names: { 'yanuo.a': '甲', 'yanuo.b': 2 }, market: { registry: 'ftp://x', scripts: true },
  }, pre);
  assert.deepEqual(s, {
    ...EMPTY, order: ['yanuo.a'], folded: ['u:a'], config: { 'yanuo.a': { n: 1 } }, names: { 'yanuo.a': '甲' },
    market: { registry: 'https://registry.npmmirror.com', scripts: true },
  });
  // 各项在配置文件里的顺序
  assert.deepEqual(Object.keys(s), ['order', 'off', 'config', 'removed', 'dev', 'devMode', 'groups', 'folded', 'names', 'market']);
  fs.rmSync(pre, { recursive: true, force: true });
});

test('组件设置里某个组件的 config 不是对象时按默认值，不影响别的组件', () => {
  const { root, store } = setup();
  component(path.join(root, 'installed'), 'yanuo.p1', { fields: [{ key: 'n', type: 'number', label: 'n', default: 1 }] });
  store.scan([]);
  const s = readComponents({ config: { 'yanuo.p1': 7 } }, path.join(root, 'pre'));
  assert.deepEqual(store.rows(s, () => false)[0]?.config, { n: 1 });
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- 面板 ----

// 一个声明了面板的组件：默认是 panel 类别(入口只在 panel.page)，入口文件写进去
function panelComponent(root: string, id: string, panel: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): void {
  const dir = path.join(root, id);
  const kind = extra['kind'] ?? 'panel';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify({
    id, kind, name: id, version: '1.0.0', author: 'test', license: 'MIT', panel: { page: 'panel.js', width: 480, height: 200, ...panel }, ...extra,
  }));
  for (const file of ['panel.js', 'page.js', 'main.js', 'window.js']) fs.writeFileSync(path.join(dir, file), `// ${id}`);
}

// 把文件的修改时间设成 seconds 秒
const touch = (file: string, seconds: number): void => fs.utimesSync(file, seconds, seconds);

test('面板目录：开着的组件声明的面板，按组件顺序，带清单的值和默认值；关着的、要的服务没开的不算；预装的标出来', () => {
  const { root, pre, store } = setup();
  const dir = path.join(root, 'installed');
  panelComponent(dir, 'a.clock', {}, { icon: 'icon.svg', name: { en: 'Clock' } });
  panelComponent(dir, 'a.kb', { width: 1400, height: 490, scale: 2, fps: 60, meters: 0.8, minMeters: 0.4, maxMeters: 1.6, spawn: 'low', keep: true, sound: true, slots: ['layout'] });
  panelComponent(dir, 'a.wrist', { anchor: 'left', meters: 0.14 });
  panelComponent(dir, 'a.needy', {}, { requires: ['weather'] });
  // 别的类别也能声明面板
  panelComponent(dir, 'a.svc', {}, { kind: 'service', provides: ['notes'], main: 'main.js' });
  component(dir, 'a.side');
  fs.mkdirSync(pre, { recursive: true });
  fs.writeFileSync(path.join(pre, 'preinstalled.json'), JSON.stringify([{ group: 'panels', ids: ['a.kb'] }, 'a.wrist']));
  store.scan([]);
  const s = { ...EMPTY, order: ['a.kb', 'a.clock', 'a.wrist', 'a.svc', 'a.needy', 'a.side'] };
  const list = store.panelInfos(s);
  assert.deepEqual(list.map(p => p.id), ['a.kb', 'a.clock', 'a.wrist', 'a.svc']);
  assert.deepEqual(list[0], {
    id: 'a.kb', name: 'a.kb', width: 1400, height: 490, scale: 2, fps: 60, meters: 0.8, minMeters: 0.4, maxMeters: 1.6,
    anchor: 'world', spawn: 'low', glance: false, keep: true,
  });
  assert.deepEqual(list[1], {
    id: 'a.clock', name: { en: 'Clock' }, icon: 'fox://component/a.clock/icon.svg', width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
    anchor: 'world', spawn: 'front', glance: false, keep: false,
  });
  assert.deepEqual([list[2]?.anchor, list[2]?.glance, list[2]?.meters], ['left', true, 0.14]);
  // 关掉、换顺序
  assert.deepEqual(store.panelInfos({ ...s, off: ['a.kb'], order: ['a.wrist', 'a.clock'] }).map(p => p.id), ['a.wrist', 'a.clock', 'a.svc']);
  // 没有声明面板的组件
  assert.deepEqual(store.panelInfos({ ...s, off: ['a.kb', 'a.clock', 'a.wrist', 'a.svc'] }), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('面板的计划：根是 panel.page，地址带入口文件的修改时间；页面尺寸、出不出声、皮肤；没有插槽的面板不加载任何部件', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  panelComponent(dir, 'a.clock', { sound: true }, { icon: 'icon.svg', config: { type: 'object', dict: { h24: { type: 'boolean', meta: { description: '24', default: true } } } } });
  component(dir, 'a.side', { requires: ['keyboard'] });
  component(dir, 'a.skin', { kind: 'skin', skin: 'skin.css', page: undefined });
  touch(path.join(dir, 'a.clock', 'panel.js'), 1700);
  fs.writeFileSync(path.join(dir, 'a.skin', 'skin.css'), '');
  touch(path.join(dir, 'a.skin', 'skin.css'), 1800);
  store.scan([]);
  const s = { ...EMPTY, config: { 'a.clock': { h24: false } } };
  assert.deepEqual(store.panelPlans(s), [{
    kind: 'panel', id: 'a.clock', size: { width: 480, height: 200 },
    root: { id: 'a.clock', kind: 'panel', name: 'a.clock', icon: 'fox://component/a.clock/icon.svg', config: { h24: false }, url: 'fox://component/a.clock/panel.js?t=1700000' },
    parts: {}, services: [], remotes: [], skin: 'fox://component/a.skin/skin.css?t=1800000', sound: true, preview: false,
  }]);
  // 入口文件变了：地址跟着变，整份计划(页面的重载签名)就不一样
  const before = JSON.stringify(store.panelPlans(s));
  touch(path.join(dir, 'a.clock', 'panel.js'), 1701);
  const after = store.panelPlans(s);
  assert.equal(after[0]?.root.url, 'fox://component/a.clock/panel.js?t=1701000');
  assert.notEqual(JSON.stringify(after), before);
  // 没有皮肤、组件关了
  assert.equal(store.panelPlans({ ...s, off: ['a.skin'] })[0]?.skin, null);
  assert.deepEqual(store.panelPlans({ ...s, off: ['a.clock'] }), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('面板的计划：各插槽里是开着的、类别等于插槽名的部件，按组件顺序；只有布局 JSON 的键盘布局带上 JSON；不是部件类别的插槽名不拉组件', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  panelComponent(dir, 'a.kb', { slots: ['candidates', 'sidepage', 'layout', 'service', 'wrist'] });
  component(dir, 'a.cand', { kind: 'candidates' });
  component(dir, 'a.quick');
  component(dir, 'a.numpad', { icon: 'n.svg' });
  component(dir, 'a.off');
  component(dir, 'a.text', { kind: 'textfield' });
  component(dir, 'a.d68', { kind: 'layout', layout: 'layout.json', page: undefined });
  fs.writeFileSync(path.join(dir, 'a.d68', 'layout.json'), JSON.stringify({ rows: 5 }));
  component(dir, 'a.svc', { kind: 'service', provides: ['wrist'] });
  for (const id of ['a.cand', 'a.quick', 'a.numpad']) touch(path.join(dir, id, 'page.js'), 1000);
  store.scan([]);
  const s = { ...EMPTY, order: ['a.kb', 'a.numpad', 'a.quick'], off: ['a.off'] };
  const [plan, ...more] = store.panelPlans(s);
  assert.equal(more.length, 0);
  assert.deepEqual(Object.keys(plan?.parts ?? {}), ['candidates', 'sidepage', 'layout', 'service', 'wrist']);
  assert.deepEqual(plan?.parts['candidates'], [{ id: 'a.cand', kind: 'candidates', name: 'a.cand', config: {}, url: 'fox://component/a.cand/page.js?t=1000000' }]);
  assert.deepEqual(plan?.parts['sidepage'], [
    { id: 'a.numpad', kind: 'sidepage', name: 'a.numpad', icon: 'fox://component/a.numpad/n.svg', config: {}, url: 'fox://component/a.numpad/page.js?t=1000000' },
    { id: 'a.quick', kind: 'sidepage', name: 'a.quick', config: {}, url: 'fox://component/a.quick/page.js?t=1000000' },
  ]);
  assert.deepEqual(plan?.parts['layout'], [{ id: 'a.d68', kind: 'layout', name: 'a.d68', config: {}, layout: { rows: 5 } }]);
  // 输入框的类别没有对应的插槽：不进这块面板；服务组件不是部件
  assert.deepEqual([plan?.parts['service'], plan?.parts['wrist']], [[], []]);
  assert.ok(!JSON.stringify(plan).includes('a.text'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('面板的计划：一个插槽名只归组件顺序最前的那块面板，后面的面板这个插槽是空的', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  panelComponent(dir, 'a.kb1', { slots: ['sidepage', 'candidates'] });
  panelComponent(dir, 'a.kb2', { slots: ['candidates', 'sidepage', 'sidebutton'] });
  component(dir, 'a.cand', { kind: 'candidates' });
  component(dir, 'a.side');
  component(dir, 'a.button', { kind: 'sidebutton' });
  store.scan([]);
  const ids = (s: ComponentSettings): Record<string, Record<string, string[]>> => Object.fromEntries(store.panelPlans(s).map(p => (
    [p.id, Object.fromEntries(Object.entries(p.parts).map(([slot, list]) => [slot, list.map(c => c.id)]))]
  )));
  assert.deepEqual(ids({ ...EMPTY, order: ['a.kb1', 'a.kb2'] }), {
    'a.kb1': { sidepage: ['a.side'], candidates: ['a.cand'] },
    'a.kb2': { candidates: [], sidepage: [], sidebutton: ['a.button'] },
  });
  // 顺序反过来：排到前面的那块拿到部件
  assert.deepEqual(ids({ ...EMPTY, order: ['a.kb2', 'a.kb1'] }), {
    'a.kb2': { candidates: ['a.cand'], sidepage: ['a.side'], sidebutton: ['a.button'] },
    'a.kb1': { sidepage: [], candidates: [] },
  });
  // 前面那块关了：部件归剩下的那块
  assert.deepEqual(ids({ ...EMPTY, order: ['a.kb1', 'a.kb2'], off: ['a.kb1'] }), { 'a.kb2': { candidates: ['a.cand'], sidepage: ['a.side'], sidebutton: ['a.button'] } });
  // 部件只进一块面板：后面那块的登记里没有它
  const second = store.panelPlans({ ...EMPTY, order: ['a.kb1', 'a.kb2'] })[1];
  assert.ok(second && !JSON.stringify(second).includes('a.side'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('面板的计划：服务是根组件和部件要用的服务沿提供者的 requires 逐层取到的、有页面入口的提供者；够得着的远程服务是这一页各组件 requires 和 uses 的合集', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  panelComponent(dir, 'a.kb', { slots: ['layout', 'sidepage'] }, { uses: ['panels'] });
  panelComponent(dir, 'a.clock');
  panelComponent(dir, 'a.notes', {}, { requires: ['notes'] });
  component(dir, 'a.d68', { kind: 'layout', requires: ['keys'] });
  component(dir, 'a.side', { requires: ['keyboard'], uses: ['usage'] });
  // 有页面入口的服务：按键渲染要 keyboard；输入法(页面部分)自己再要一个只有主进程代码的服务
  component(dir, 'a.keys', { kind: 'service', provides: ['keys'], requires: ['keyboard'] });
  component(dir, 'a.ime', { kind: 'service', provides: ['keyboard'], requires: ['dict'], uses: ['clock'], main: 'main.js' });
  component(dir, 'a.dict', { kind: 'service', provides: ['dict'], requires: ['deep'], main: 'main.js', page: undefined });
  component(dir, 'a.deep', { kind: 'service', provides: ['deep'] });
  // 这一页用不到的服务、主窗口组件提供的服务(它的 page 是主窗口入口)、排在后面的同名提供者
  component(dir, 'a.unused', { kind: 'service', provides: ['unused'] });
  component(dir, 'a.win', { kind: 'window', provides: ['notes'] });
  component(dir, 'a.keys2', { kind: 'service', provides: ['keys'] });
  for (const id of ['a.keys', 'a.ime', 'a.deep']) touch(path.join(dir, id, 'page.js'), 5);
  store.scan([]);
  const s = { ...EMPTY, order: ['a.kb', 'a.clock', 'a.notes', 'a.deep', 'a.keys', 'a.ime'] };
  const [kb, clock, notes] = store.panelPlans(s);
  assert.deepEqual(kb?.services, [
    { id: 'a.deep', kind: 'service', name: 'a.deep', config: {}, url: 'fox://component/a.deep/page.js?t=5000' },
    { id: 'a.keys', kind: 'service', name: 'a.keys', config: {}, url: 'fox://component/a.keys/page.js?t=5000' },
    { id: 'a.ime', kind: 'service', name: 'a.ime', config: {}, url: 'fox://component/a.ime/page.js?t=5000' },
  ]);
  // 只算这一页加载的组件写的名字：没有页面入口的提供者(a.dict)要的 deep 不算
  assert.deepEqual([...(kb?.remotes ?? [])].sort(), ['clock', 'dict', 'keyboard', 'keys', 'panels', 'usage']);
  // 什么都不要的面板：没有服务，够不着任何远程服务
  assert.deepEqual([clock?.services, clock?.remotes], [[], []]);
  // 提供者是主窗口组件：不加载它的 page；服务名照样够得着(写在 requires 里)
  assert.deepEqual([notes?.services, notes?.remotes], [[], ['notes']]);
  // 提供者关了(连同排在后面的同名提供者)：要它的部件不算开着，它带来的服务也没了
  const noIme = store.panelPlans({ ...s, off: ['a.ime', 'a.keys2'] })[0];
  assert.deepEqual([noIme?.parts, noIme?.services, noIme?.remotes], [{ layout: [], sidepage: [] }, [], ['panels']]);
  // 排最前的提供者关了：用后面那个
  const other = store.panelPlans({ ...s, off: ['a.keys'] })[0];
  assert.deepEqual(other?.services.map(c => c.id), ['a.deep', 'a.ime', 'a.keys2']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('媒体页面的计划：输出、输入源、翻译组件的页面代码，和它们要用的服务里有页面入口的提供者；够得着的远程服务按这些组件算', () => {
  const { root, store } = setup();
  const dir = path.join(root, 'installed');
  component(dir, 'a.tts', { kind: 'output', main: 'main.js', requires: ['cloud'] });
  component(dir, 'a.asr', { kind: 'input', main: 'main.js', uses: ['keyboard'] });
  component(dir, 'a.chat', { kind: 'output', main: 'main.js', page: undefined, requires: ['osc'] });
  component(dir, 'a.cloud', { kind: 'service', provides: ['cloud'], requires: ['audio'], main: 'main.js', page: undefined });
  component(dir, 'a.audio', { kind: 'service', provides: ['audio'], uses: ['usage'] });
  component(dir, 'a.osc', { kind: 'service', provides: ['osc'] });
  component(dir, 'a.side');
  for (const id of ['a.tts', 'a.asr', 'a.chat', 'a.cloud']) fs.writeFileSync(path.join(dir, id, 'main.js'), '');
  for (const id of ['a.tts', 'a.asr', 'a.audio']) touch(path.join(dir, id, 'page.js'), 7);
  store.scan([]);
  const s = { ...EMPTY, order: ['a.tts', 'a.asr'] };
  assert.deepEqual(store.mediaPlan(s), {
    kind: 'media',
    components: [
      { id: 'a.tts', kind: 'output', name: 'a.tts', config: {}, url: 'fox://component/a.tts/page.js?t=7000' },
      { id: 'a.asr', kind: 'input', name: 'a.asr', config: {}, url: 'fox://component/a.asr/page.js?t=7000' },
    ],
    // 没有页面代码的输出要的服务(osc)不进媒体页面
    services: [{ id: 'a.audio', kind: 'service', name: 'a.audio', config: {}, url: 'fox://component/a.audio/page.js?t=7000' }],
    remotes: ['cloud', 'keyboard', 'usage'],
  });
  assert.deepEqual(store.mediaPlan({ ...s, off: ['a.tts', 'a.asr'] }), { kind: 'media', components: [], services: [], remotes: [] });
  fs.rmSync(root, { recursive: true, force: true });
});

test('带代码和安装：只有面板入口的组件算带代码；panel.page 指的文件要在包里', () => {
  const { root, store } = setup();
  const src = path.join(root, 'src');
  panelComponent(src, 'a.clock');
  const manifest = ComponentStore.read(path.join(src, 'a.clock'));
  assert.ok(manifest.ok);
  assert.deepEqual([manifest.manifest.page, manifest.manifest.main, hasCode(manifest.manifest, path.join(src, 'a.clock'))], [undefined, undefined, true]);
  const zip = path.join(root, 'clock.zip');
  execFileSync(TAR, ['-a', '-cf', zip, '-C', path.join(src, 'a.clock'), '.'], { windowsHide: true });
  const ok = store.stage(zip);
  assert.ok(ok.ok && ok.code);
  store.discard();
  fs.rmSync(path.join(src, 'a.clock', 'panel.js'));
  fs.rmSync(zip);
  execFileSync(TAR, ['-a', '-cf', zip, '-C', path.join(src, 'a.clock'), '.'], { windowsHide: true });
  const missing = store.stage(zip);
  assert.ok(!missing.ok && 'error' in missing);
  assert.match(missing.error, /panel\.page 指向的 panel\.js 不在包里/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('只在这次运行加载的组件：一直开着、排在全部组件前面，是同名服务最前的提供者，进组件进程；不出现在组件列表、应用信息和设置的顺序里', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-comp-'));
  const pre = path.join(root, 'pre');
  const dev = path.join(root, 'dev');
  const logs: string[] = [];
  component(dev, 'dev.display', { kind: 'service', page: undefined, main: 'page.js', provides: ['panels'] });
  const store = new ComponentStore({
    dir: path.join(root, 'installed'), preinstalled: pre, log: t => logs.push(t),
    extra: [path.join(dev, 'dev.display'), path.join(dev, 'missing')],
  });
  const dir = path.join(root, 'installed');
  component(dir, 'a.vr', { kind: 'service', page: undefined, main: 'page.js', provides: ['panels'] });
  component(dir, 'a.side');
  store.scan([]);
  // 读不了的那个文件夹只记一行日志，不列进不能加载的组件
  assert.deepEqual([store.broken, logs.length], [[], 1]);
  assert.match(logs[0] ?? '', /^missing cannot load: 读不了 component\.json：/);
  const s: ComponentSettings = { ...EMPTY, order: ['a.vr', 'a.side'] };
  assert.deepEqual(store.active(s).map(c => c.manifest.id), ['dev.display', 'a.vr', 'a.side']);
  assert.deepEqual(store.providers('panels', s), ['dev.display', 'a.vr']);
  assert.deepEqual(store.mainComponents(s).map(c => c.id), ['dev.display', 'a.vr']);
  // 设置里把它关掉也照样开着
  assert.deepEqual(store.providers('panels', { ...s, off: ['dev.display', 'a.vr'] }), ['dev.display']);
  // 用户看得到的地方都没有它
  assert.deepEqual(store.all.map(c => c.manifest.id).sort(), ['a.side', 'a.vr']);
  assert.deepEqual(store.rows(s, () => false).map(r => r.id), ['a.vr', 'a.side']);
  assert.deepEqual(store.appComponents(s).map(c => c.id), ['a.vr', 'a.side']);
  assert.deepEqual(applyPatch(s, { kind: 'order', ids: ['a.side', 'a.vr'] }, store.all).order, ['a.side', 'a.vr']);
  // 它的文件照常能取到
  assert.equal(store.resolve('dev.display', 'page.js'), path.join(dev, 'dev.display', 'page.js'));
  assert.equal(store.get('dev.display')?.extra, true);
  fs.rmSync(root, { recursive: true, force: true });
});
