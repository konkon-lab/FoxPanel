import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { electron, FakeProcess, invoke, invokeFrom, ipc, refused, resetElectron, senders, settled, until, writeComponent } from './comp-helpers.ts';
import { POLICY } from '../src/main/ipc.ts';
import { readComponents } from '../src/main/components/settings.ts';
import { TAR } from '../src/main/components/store.ts';
import { BUS_COMPONENT_REMOVED, IPC, type ComponentList, type ComponentPatch, type ComponentSettings } from '../src/shared/types.ts';

// manager.ts 导入 electron：在假接口装好之后加载
const { ComponentManager } = await import('../src/main/components/manager.ts');

// 设置的 Schema：一个数字、一个 secret(share 有值时是共用的)
const config = (share?: string): object => ({
  type: 'object',
  dict: {
    n: { type: 'number', meta: { description: 'n', default: 1 } },
    apiKey: { type: 'string', meta: { description: 'k', role: 'secret', ...(share ? { share } : {}) } },
  },
});

const PACKAGE = 'foxpanel-component-x';

// 假的 yarn：add 往 package.json 写依赖并把 manifest 放进 node_modules/<包名>，remove 反过来；下一轮事件循环以退出码 0 退出
function fakeYarn(id: string, manifest: Record<string, unknown>): typeof electron.fork {
  return (_file, args, opts) => {
    const p = new FakeProcess();
    const cwd = opts.cwd ?? '';
    const [, cmd, arg = ''] = args;
    const file = path.join(cwd, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { dependencies: Record<string, string> };
    if (cmd === 'add') {
      const at = arg.lastIndexOf('@');
      pkg.dependencies[arg.slice(0, at)] = arg.slice(at + 1);
      writeComponent(path.join(cwd, 'node_modules'), id, manifest, arg.slice(0, at));
    } else {
      delete pkg.dependencies[arg];
      fs.rmSync(path.join(cwd, 'node_modules', arg), { recursive: true, force: true });
    }
    fs.writeFileSync(file, JSON.stringify(pkg));
    setImmediate(() => p.emit('exit', 0));
    return p;
  };
}

// 仓库里 PACKAGE 的包信息(发布满一天)
const registryDoc = (id: string): object => ({
  name: PACKAGE, 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': new Date(Date.now() - 3 * 86_400_000).toISOString() },
  versions: { '1.0.0': { version: '1.0.0', license: 'MIT', foxpanel: { id, kind: 'sidepage', name: 'X' } } },
});

interface Rig {
  root: string;
  dir: string;                       // 组件目录
  manager: InstanceType<typeof ComponentManager>;
  settings(): ComponentSettings;
  scans(): number;                   // 扫描过几次
  changed: number[];                 // 每通知宿主一次「组件变了」记一项
  sent: [string, unknown][];         // 发给主窗口的消息
  bus: [string, unknown][];
  hostErrors: Map<string, string>;   // 组件进程里加载出错的组件(测试里可以改)
  pageErrors: Map<string, string>;   // 面板页面出错的组件(测试里可以改)
  list(): Promise<ComponentList>;
}

// 一套临时数据文件夹上的组件管理；prepare 在启动前往组件目录(dir)和预装目录(pre)里放东西；extra 是只在这次运行加载的组件文件夹
function rig(t: TestContext, prepare: (dir: string, pre: string) => void = () => undefined, extra: string[] = []): Rig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-manager-'));
  const pre = path.join(root, 'pre');
  const dir = path.join(root, 'data', 'components');
  fs.mkdirSync(pre);
  fs.mkdirSync(dir, { recursive: true });
  prepare(dir, pre);
  let settings = readComponents(undefined, pre);
  const changed: number[] = [];
  const sent: [string, unknown][] = [];
  const bus: [string, unknown][] = [];
  const hostErrors = new Map<string, string>();
  const pageErrors = new Map<string, string>();
  // 主窗口只用到这两个成员
  const win = { isDestroyed: () => false, webContents: { send: (channel: string, data: unknown) => sent.push([channel, data]) } } as unknown as BrowserWindow;
  const manager = new ComponentManager({
    userData: path.join(root, 'data'), preinstalled: pre, extra, yarn: 'yarn.cjs', yarnHost: 'yarn-host.cjs', version: '0.1.0',
    get: () => settings, save: s => { settings = s; }, changed: () => { changed.push(changed.length); }, bus: (channel, data) => bus.push([channel, data]),
    host: () => ({ status: 'idle', errors: hostErrors, outputs: [], inputs: [], translator: false, restart: () => undefined }),
    window: () => win, pageErrors: () => pageErrors, log: () => undefined,
  });
  let scans = 0;
  const scan = manager.store.scan.bind(manager.store);
  manager.store.scan = (...args) => {
    scans++;
    scan(...args);
  };
  resetElectron();
  manager.registerIpc(ipc);
  t.after(() => {
    manager.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, dir, manager, settings: () => settings, scans: () => scans, changed, sent, bus, hostErrors, pageErrors, list: () => invoke(IPC.compList) as Promise<ComponentList> };
}

const listEvents = (r: Rig): number => r.sent.filter(([channel]) => channel === IPC.compListEvent).length;
// 推给主窗口的各次页面组件计划
const windowPlans = (r: Rig): unknown[] => r.sent.filter(([channel]) => channel === IPC.windowPlanEvent).map(([, plan]) => plan);
const nextTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('until：等到条件为真就返回；超时的报错带上等了多久和当时的情况', async () => {
  let n = 0;
  await until(() => ++n >= 3);
  assert.equal(n, 3);
  await assert.rejects(until(() => false, () => 'version 1.0.0', 60), /^Error: timed out after \d+ ms: version 1\.0\.0$/);
  await assert.rejects(until(() => false, undefined, 60), /^Error: timed out after \d+ ms$/);
});

test('启动扫描一次；secret 解密完只把列表推给主窗口', async t => {
  const r = rig(t, dir => writeComponent(dir, 'test.a', { config: config() }));
  r.manager.start();
  assert.equal(r.scans(), 1);
  await until(() => listEvents(r) === 1);
  assert.equal(r.scans(), 1);
  assert.equal(r.changed.length, 0);
});

test('改设置、存 secret 不重新扫描，照样发布；格式不对的改动不动设置', async t => {
  const r = rig(t, dir => writeComponent(dir, 'test.a', { config: config() }));
  r.manager.start();
  const quiet: ComponentPatch[] = [
    { kind: 'fold', key: 'u:g', folded: true },
    { kind: 'on', id: 'test.a', on: false },
    { kind: 'on', id: 'test.a', on: true },
    { kind: 'configs', id: 'test.a', values: { n: 2 } },
    { kind: 'name', id: 'test.a', name: '甲' },
    { kind: 'order', ids: ['test.a'] },
    { kind: 'groups', groups: [{ id: 'g', name: '组', ids: ['test.a'] }] },
    { kind: 'market', market: { registry: 'https://example.com', scripts: false } },
    { kind: 'none', of: 'skin' },
  ];
  for (const patch of quiet) assert.deepEqual(await invoke(IPC.compSet, patch), { ok: true }, patch.kind);
  assert.deepEqual(await invoke(IPC.compSecret, 'test.a', 'apiKey', 'sk-abcdefgh'), { ok: true });
  assert.equal(r.scans(), 1);
  assert.equal(r.changed.length, quiet.length + 1);
  const row = (await r.list()).rows[0];
  assert.deepEqual([row?.config, row?.secrets, row?.secretHints], [{ n: 2 }, { apiKey: true }, { apiKey: 'sk-a••••••gh' }]);
  assert.deepEqual(r.settings().names, { 'test.a': '甲' });

  const before = r.settings();
  for (const bad of [{}, { kind: 'x' }, { kind: 'devMode', on: 1 }, { kind: 'fold', key: {}, folded: true }, null]) {
    const result = await invoke(IPC.compSet, bad) as { ok: boolean };
    assert.equal(result.ok, false, JSON.stringify(bad));
  }
  assert.equal(r.settings(), before);
  assert.deepEqual(await invoke(IPC.compSecret, 'test.a', 'n', 'x'), { ok: false, error: '没有这个设置项' });
  assert.deepEqual(await invoke(IPC.compSecret, 'test.a', 'apiKey', 5), { ok: false, error: '参数不对' });
  assert.equal(r.changed.length, quiet.length + 1);
  assert.equal(r.scans(), 1);
});

test('开发者模式、开发文件夹的增减和改动都重新扫描；移除开发中的组件不删文件夹', async t => {
  const r = rig(t);
  const work = writeComponent(path.join(r.root, 'work'), 'test.dev');
  r.manager.start();
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'devMode', on: true }), { ok: true });
  assert.equal(r.scans(), 2);
  electron.picked = { canceled: false, filePaths: [work] };
  assert.deepEqual(await invoke(IPC.compDevAdd), { ok: true });
  assert.equal(r.scans(), 3);
  assert.equal(r.manager.store.get('test.dev')?.dev, true);
  assert.deepEqual(r.settings().order, ['test.dev']);
  // 文件夹里的文件改了：监视触发重载
  writeComponent(path.join(r.root, 'work'), 'test.dev', { version: '1.1.0' });
  await until(() => r.manager.store.get('test.dev')?.manifest.version === '1.1.0', () => `version ${r.manager.store.get('test.dev')?.manifest.version ?? 'none'}, ${r.scans()} scans`);
  assert.ok(r.scans() > 3);
  // 等连续的文件事件过去
  await settled(() => r.scans());
  let n = r.scans();
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'devMode', on: false }), { ok: true });
  assert.equal(r.scans(), ++n);
  assert.equal(r.manager.store.get('test.dev'), undefined);
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'devMode', on: true }), { ok: true });
  assert.equal(r.scans(), ++n);
  assert.deepEqual(await invoke(IPC.compRemove, 'test.dev'), { ok: true });
  assert.equal(r.scans(), ++n);
  assert.deepEqual([r.settings().dev, r.manager.store.all.length], [[], 0]);
  assert.ok(fs.existsSync(path.join(work, 'component.json')));
  assert.deepEqual(r.bus, []);
  // 选的文件夹清单不合格：不登记
  electron.picked = { canceled: false, filePaths: [r.root] };
  assert.equal((await invoke(IPC.compDevAdd) as { ok: boolean }).ok, false);
  electron.picked = { canceled: true, filePaths: [] };
  assert.deepEqual(await invoke(IPC.compDevAdd), { ok: true });
  assert.deepEqual(r.settings().dev, []);
});

test('开发文件夹里面板的入口文件保存后：监视触发、通知宿主组件变了，这块面板的计划(页面的重载签名)跟着换，别的面板的计划不变', async t => {
  const panel = { kind: 'panel', page: undefined, panel: { page: 'panel.js', width: 480, height: 200 } };
  const r = rig(t, dir => {
    fs.writeFileSync(path.join(writeComponent(dir, 'test.kb', panel), 'panel.js'), '// kb');
  });
  const work = writeComponent(path.join(r.root, 'work'), 'test.clock', panel);
  const entry = path.join(work, 'panel.js');
  fs.writeFileSync(entry, '// clock');
  fs.utimesSync(entry, 1700, 1700);
  r.manager.start();
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'devMode', on: true }), { ok: true });
  electron.picked = { canceled: false, filePaths: [work] };
  assert.deepEqual(await invoke(IPC.compDevAdd), { ok: true });
  // 一块面板的计划(JSON)；没有这块面板时为空串
  const planOf = (id: string): string => JSON.stringify(r.manager.store.panelPlans(r.settings()).find(p => p.id === id) ?? '');
  const before = { kb: planOf('test.kb'), clock: planOf('test.clock') };
  assert.match(before.kb, /fox:\/\/component\/test\.kb\/panel\.js\?t=\d+/);
  assert.match(before.clock, /fox:\/\/component\/test\.clock\/panel\.js\?t=1700000"/);
  // 等加载文件夹时的文件事件过去
  await settled(() => r.changed.length);
  const notified = r.changed.length;
  fs.writeFileSync(entry, '// clock, saved');
  fs.utimesSync(entry, 1800, 1800);
  await until(() => r.changed.length > notified, () => `${r.changed.length} notifications, ${notified} before the save`);
  assert.match(planOf('test.clock'), /fox:\/\/component\/test\.clock\/panel\.js\?t=1800000"/);
  assert.notEqual(planOf('test.clock'), before.clock);
  assert.equal(planOf('test.kb'), before.kb);
});

test('装 zip、卸载、删不能加载的文件夹都重新扫描；卸载后清掉设置并经总线通知', async t => {
  const r = rig(t, dir => {
    fs.mkdirSync(path.join(dir, 'test.bad'));
    fs.writeFileSync(path.join(dir, 'test.bad', 'component.json'), '{');
  });
  r.manager.start();
  const src = writeComponent(path.join(r.root, 'src'), 'test.zip', { config: config() });
  const zip = path.join(r.root, 'a.zip');
  execFileSync(TAR, ['-a', '-cf', zip, '-C', src, '.'], { windowsHide: true });
  electron.picked = { canceled: false, filePaths: [zip] };
  const preview = await invoke(IPC.compPick) as { ok: boolean };
  assert.equal(preview.ok, true);
  assert.equal(r.scans(), 1);
  assert.deepEqual(await invoke(IPC.compInstall, true), { ok: true });
  assert.equal(r.scans(), 2);
  assert.deepEqual((await r.list()).rows.map(x => x.id), ['test.zip']);
  assert.deepEqual(r.settings().order, ['test.zip']);
  // 没有选好的包时确认安装报错(失败的安装也扫描)，放弃不报错
  assert.equal((await invoke(IPC.compInstall, true) as { ok: boolean }).ok, false);
  assert.equal(r.scans(), 3);
  assert.deepEqual(await invoke(IPC.compInstall, false), { ok: true });
  assert.equal(r.scans(), 3);

  assert.deepEqual(await invoke(IPC.compSet, { kind: 'configs', id: 'test.zip', values: { n: 7 } }), { ok: true });
  assert.deepEqual(await invoke(IPC.compSecret, 'test.zip', 'apiKey', 'sk-1'), { ok: true });
  await invoke(IPC.storageCall, 'test.zip', { op: 'set', key: 'k', value: 1 });
  await assert.rejects(invoke(IPC.storageCall, 'test.zip', { op: 'x', key: 'k' }), /操作不对/);
  await assert.rejects(invoke(IPC.storageCall, 5, { op: 'get', key: 'k' }), /参数不对/);
  assert.equal(await invoke(IPC.storageCall, 'test.zip', { op: 'get', key: 'k' }), 1);

  // 只打开登记过的组件文件夹
  await invoke(IPC.compOpenFolder, r.root);
  await invoke(IPC.compOpenFolder, path.join(r.dir, 'test.zip'));
  assert.deepEqual(electron.opened, [path.join(r.dir, 'test.zip')]);

  // id 不是「作者.名字」格式：不删任何东西
  assert.equal((await invoke(IPC.compRemove, '../../src/test.zip') as { ok: boolean }).ok, false);
  assert.ok(fs.existsSync(path.join(src, 'component.json')));
  assert.equal(r.scans(), 4);
  assert.deepEqual(await invoke(IPC.compRemove, 5), { ok: false, error: '参数不对' });
  assert.equal(r.scans(), 4);

  assert.deepEqual(await invoke(IPC.compRemove, 'test.zip'), { ok: true });
  assert.equal(r.scans(), 5);
  assert.ok(!fs.existsSync(path.join(r.dir, 'test.zip')));
  assert.deepEqual([r.settings().order, r.settings().config], [[], {}]);
  assert.equal(r.manager.secrets.has('test.zip', 'apiKey'), false);
  assert.equal(await invoke(IPC.storageCall, 'test.zip', { op: 'get', key: 'k' }), null);
  assert.deepEqual(r.bus, [[BUS_COMPONENT_REMOVED, 'test.zip']]);

  const bad = path.join(r.dir, 'test.bad');
  assert.deepEqual((await r.list()).broken.map(b => b.folder), [bad]);
  assert.deepEqual(await invoke(IPC.compRemoveBroken, bad), { ok: true });
  assert.equal(r.scans(), 6);
  assert.ok(!fs.existsSync(bad));
  assert.deepEqual((await r.list()).broken, []);
  assert.equal((await invoke(IPC.compRemoveBroken, r.root) as { ok: boolean }).ok, false);
  assert.ok(fs.existsSync(r.root));
});

test('改磁盘的操作失败：重新扫描并发布，列表和磁盘一致', async t => {
  const r = rig(t, dir => {
    writeComponent(dir, 'test.a');
    writeComponent(dir, 'test.b');
    fs.mkdirSync(path.join(dir, 'test.bad'));
    writeComponent(path.join(dir, 'node_modules'), 'test.npm', {}, PACKAGE);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { [PACKAGE]: '1.0.0' } }));
  });
  const ids = async (): Promise<string[]> => (await r.list()).rows.map(x => x.id).sort();
  r.manager.start();
  assert.deepEqual(await ids(), ['test.a', 'test.b', 'test.npm']);
  // 文件夹被外部删掉：卸载报错，这一行从列表里消失
  fs.rmSync(path.join(r.dir, 'test.a'), { recursive: true });
  assert.deepEqual(await invoke(IPC.compRemove, 'test.a'), { ok: false, error: '没有这个组件' });
  assert.equal(r.scans(), 2);
  assert.equal(r.changed.length, 1);
  assert.deepEqual(await ids(), ['test.b', 'test.npm']);

  // zip 覆盖安装时复制失败：旧文件夹已删，列表里没有它
  const src = writeComponent(path.join(r.root, 'src'), 'test.b', { version: '2.0.0' });
  const zip = path.join(r.root, 'b.zip');
  execFileSync(TAR, ['-a', '-cf', zip, '-C', src, '.'], { windowsHide: true });
  electron.picked = { canceled: false, filePaths: [zip] };
  assert.equal((await invoke(IPC.compPick) as { ok: boolean }).ok, true);
  const copy = t.mock.method(fs, 'cpSync', () => { throw new Error('ENOSPC: no space left on device'); });
  assert.deepEqual(await invoke(IPC.compInstall, true), { ok: false, error: 'ENOSPC: no space left on device' });
  copy.mock.restore();
  assert.equal(r.scans(), 3);
  assert.equal(r.changed.length, 2);
  assert.deepEqual(await ids(), ['test.npm']);

  // yarn 删了包里的文件后以非 0 退出码结束：这一行从列表里消失，包列进 broken
  electron.fork = (_file, _args, opts) => {
    const p = new FakeProcess();
    fs.rmSync(path.join(opts.cwd ?? '', 'node_modules', PACKAGE), { recursive: true, force: true });
    setImmediate(() => p.emit('exit', 1));
    return p;
  };
  assert.equal((await invoke(IPC.compRemove, 'test.npm') as { ok: boolean }).ok, false);
  assert.equal(r.scans(), 4);
  assert.equal(r.changed.length, 3);
  assert.deepEqual(await ids(), []);
  assert.deepEqual((await r.list()).broken.map(b => b.name).sort(), [PACKAGE, 'test.bad']);
  // 装包时 yarn 失败
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify(registryDoc('test.new')))));
  assert.equal((await invoke(IPC.compNpm, { op: 'add', name: PACKAGE, version: '1.0.0' }) as { ok: boolean }).ok, false);
  assert.equal(r.scans(), 5);
  assert.equal(r.changed.length, 4);

  // 删不掉的坏文件夹：报错，仍列在 broken 里
  const bad = path.join(r.dir, 'test.bad');
  const rm = t.mock.method(fs, 'rmSync', () => { throw new Error('EBUSY: resource busy or locked'); });
  assert.deepEqual(await invoke(IPC.compRemoveBroken, bad), { ok: false, error: 'EBUSY: resource busy or locked' });
  rm.mock.restore();
  assert.equal(r.scans(), 6);
  assert.equal(r.changed.length, 5);
  assert.ok((await r.list()).broken.some(b => b.folder === bad));
  assert.deepEqual(r.bus, []);
});

test('npm 装上、卸载都重新扫描；参数不对的不执行', async t => {
  const r = rig(t);
  r.manager.start();
  electron.fork = fakeYarn('test.npm', {});
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify(registryDoc('test.npm')))));
  for (const bad of [null, { op: 'add', name: PACKAGE }, { op: 'x', name: PACKAGE }, { op: 'remove' }]) {
    assert.deepEqual(await invoke(IPC.compNpm, bad), { ok: false, error: '参数不对' });
  }
  assert.equal((await invoke(IPC.compNpm, { op: 'remove', name: 'left-pad' }) as { ok: boolean }).ok, false);
  assert.equal(r.scans(), 1);
  assert.deepEqual(await invoke(IPC.compNpm, { op: 'add', name: PACKAGE, version: '1.0.0' }), { ok: true });
  assert.equal(r.scans(), 2);
  assert.equal(r.manager.store.get('test.npm')?.npm, PACKAGE);
  assert.deepEqual(r.settings().order, ['test.npm']);
  assert.equal(r.changed.length, 1);
  // 按组件 id 卸载 npm 装的组件：卸包
  assert.deepEqual(await invoke(IPC.compRemove, 'test.npm'), { ok: true });
  assert.equal(r.scans(), 3);
  assert.deepEqual([r.manager.store.all.length, r.manager.yarn.dependencies(), r.settings().order], [0, {}, []]);
  assert.deepEqual(r.bus, [[BUS_COMPONENT_REMOVED, 'test.npm']]);
});

test('npm 装完发现包里组件的 id 和 package.json 写的不一致：卸掉并报错', async t => {
  const r = rig(t);
  r.manager.start();
  electron.fork = fakeYarn('test.other', {});
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify(registryDoc('test.npm')))));
  const result = await invoke(IPC.compNpm, { op: 'add', name: PACKAGE, version: '1.0.0' }) as { ok: boolean; error?: string };
  assert.match(result.error ?? '', /不一致/);
  assert.deepEqual([r.manager.store.all.length, r.manager.yarn.dependencies(), r.settings().order], [0, {}, []]);
});

test('卸掉盖在同 id 文件夹组件上面的 npm 包：设置、secret、数据留给文件夹组件', async t => {
  const r = rig(t, dir => {
    writeComponent(dir, 'test.x', { config: config() });
    writeComponent(path.join(dir, 'node_modules'), 'test.x', { version: '3.0.0', config: config() }, PACKAGE);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { [PACKAGE]: '3.0.0' } }));
  });
  r.manager.start();
  electron.fork = fakeYarn('test.x', {});
  assert.equal(r.manager.store.get('test.x')?.npm, PACKAGE);
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'configs', id: 'test.x', values: { n: 5 } }), { ok: true });
  assert.deepEqual(await invoke(IPC.compSecret, 'test.x', 'apiKey', 'sk-1'), { ok: true });
  await invoke(IPC.storageCall, 'test.x', { op: 'set', key: 'k', value: 1 });

  assert.deepEqual(await invoke(IPC.compRemove, 'test.x'), { ok: true });
  const left = r.manager.store.get('test.x');
  assert.deepEqual([left?.npm, left?.manifest.version], [undefined, '1.0.0']);
  assert.deepEqual(r.settings().config, { 'test.x': { n: 5 } });
  assert.equal(r.manager.secrets.has('test.x', 'apiKey'), true);
  assert.equal(await invoke(IPC.storageCall, 'test.x', { op: 'get', key: 'k' }), 1);
  assert.deepEqual(r.bus, []);
  assert.deepEqual((await r.list()).rows.map(x => [x.id, x.version]), [['test.x', '1.0.0']]);

  // 文件夹组件也卸掉：这时才清
  assert.deepEqual(await invoke(IPC.compRemove, 'test.x'), { ok: true });
  assert.deepEqual(r.settings().config, {});
  assert.equal(r.manager.secrets.has('test.x', 'apiKey'), false);
  assert.deepEqual(r.bus, [[BUS_COMPONENT_REMOVED, 'test.x']]);
});

test('主窗口的页面组件计划：变了才推给主窗口', async t => {
  const r = rig(t, dir => {
    writeComponent(dir, 'test.win', { kind: 'window', config: config() });
    writeComponent(dir, 'test.a');
  });
  r.manager.start();
  const page = { id: 'test.win', kind: 'window', name: 'test.win', url: 'fox://component/test.win/page.js' };
  assert.deepEqual(await invoke(IPC.windowPlan), [{ ...page, config: { n: 1 } }]);
  // 普通组件的开关不影响主窗口要加载的组件
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'on', id: 'test.a', on: false }), { ok: true });
  assert.deepEqual(windowPlans(r), []);
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'configs', id: 'test.win', values: { n: 2 } }), { ok: true });
  assert.deepEqual(windowPlans(r), [[{ ...page, config: { n: 2 } }]]);
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'on', id: 'test.win', on: false }), { ok: true });
  assert.deepEqual(windowPlans(r), [[{ ...page, config: { n: 2 } }], []]);
  assert.equal(r.changed.length, 3);
});

test('启动时新同步进来的预装组件排到顺序最后；清单写了 enabled: false 的关着', t => {
  const r = rig(t, (dir, pre) => {
    writeComponent(dir, 'test.old');
    writeComponent(pre, 'test.on');
    writeComponent(pre, 'test.held', { enabled: false });
    fs.writeFileSync(path.join(pre, 'preinstalled.json'), JSON.stringify(['test.on', 'test.held']));
  });
  r.manager.start();
  assert.deepEqual([r.settings().order, r.settings().off], [['test.on', 'test.held'], ['test.held']]);
  assert.deepEqual(r.manager.store.active(r.settings()).map(c => c.manifest.id), ['test.on', 'test.old']);
});

test('组件进程状态变了：同一轮里的多次只推一次列表；停了之后不推', async t => {
  const r = rig(t, dir => writeComponent(dir, 'test.a'));
  r.manager.start();
  await until(() => listEvents(r) === 1);
  for (let i = 0; i < 3; i++) r.manager.hostChanged();
  assert.equal(listEvents(r), 1);
  await nextTurn();
  assert.equal(listEvents(r), 2);
  // 排着的一次遇上发布：发布时推过，不另推
  r.manager.hostChanged();
  r.manager.apply({ kind: 'on', id: 'test.a', on: false });
  assert.equal(listEvents(r), 3);
  await nextTurn();
  assert.equal(listEvents(r), 3);
  r.manager.hostChanged();
  r.manager.stop();
  await nextTurn();
  assert.equal(listEvents(r), 3);
});

test('主进程组件的设置带上 secret：几个组件共用的 secret 一次加载只解密一次', async t => {
  const r = rig(t, dir => {
    writeComponent(dir, 'test.cloud', { kind: 'service', page: undefined, provides: ['cloud'], config: config('cloud') });
    for (const id of ['test.out-a', 'test.out-b']) writeComponent(dir, id, { kind: 'output', page: undefined, main: 'main.js', requires: ['cloud'] });
  });
  r.manager.start();
  assert.deepEqual(await invoke(IPC.compSecret, 'test.cloud', 'apiKey', 'sk-abcdefgh'), { ok: true });
  electron.decrypts = 0;
  const list = await r.manager.mainComponents();
  assert.deepEqual(list.map(c => [c.id, c.config]), [
    ['test.out-a', { n: 1, apiKey: 'sk-abcdefgh' }],
    ['test.out-b', { n: 1, apiKey: 'sk-abcdefgh' }],
  ]);
  assert.equal(electron.decrypts, 1);
});

test('列表里的错误：组件进程里加载出错的和面板页面出错的都显示在那个组件上，两样都有时用加载的错误', async t => {
  const r = rig(t, dir => {
    writeComponent(dir, 'test.clock', { kind: 'panel', page: undefined, panel: { page: 'panel.js', width: 480, height: 200 } });
    writeComponent(dir, 'test.both', { main: 'main.js', panel: { page: 'panel.js', width: 480, height: 200 } });
    writeComponent(dir, 'test.fine');
  });
  r.manager.start();
  const errors = async (): Promise<Record<string, string | undefined>> => Object.fromEntries((await r.list()).rows.map(row => [row.id, row.error]));
  assert.deepEqual(await errors(), { 'test.both': undefined, 'test.clock': undefined, 'test.fine': undefined });
  r.pageErrors.set('test.clock', 'page process gone: crashed 1');
  r.pageErrors.set('test.both', 'ERR_FAILED (-2)');
  assert.deepEqual(await errors(), { 'test.both': 'ERR_FAILED (-2)', 'test.clock': 'page process gone: crashed 1', 'test.fine': undefined });
  r.hostErrors.set('test.both', '入口没有默认导出');
  assert.deepEqual(await errors(), { 'test.both': '入口没有默认导出', 'test.clock': 'page process gone: crashed 1', 'test.fine': undefined });
  r.pageErrors.clear();
  r.hostErrors.clear();
  assert.deepEqual(await errors(), { 'test.both': undefined, 'test.clock': undefined, 'test.fine': undefined });
  // 面板组件算带代码，类别是 panel
  const clock = (await r.list()).rows.find(row => row.id === 'test.clock');
  assert.deepEqual([clock?.kind, clock?.code, clock?.on, clock?.active], ['panel', true, true, true]);
});

test('面板页面发来的调用：组件管理的通道都不处理；组件数据只能用这一页计划里的组件 id', async t => {
  const PANEL = 31;
  const r = rig(t, dir => {
    writeComponent(dir, 'test.clock', { kind: 'panel', page: undefined, panel: { page: 'panel.js', width: 480, height: 200 } });
    writeComponent(dir, 'test.b');
  });
  r.manager.start();
  senders.addPanel(PANEL, 'test.clock', ['test.clock'], []);
  t.after(() => senders.remove(PANEL));
  refused.length = 0;
  const names = Object.keys(IPC) as (keyof typeof IPC)[];
  const closed = [...electron.handlers.keys()].filter(channel => !names.some(n => IPC[n] === channel && POLICY[n].includes('panel')));
  for (const channel of [IPC.compList, IPC.compRemove, IPC.compSet, IPC.compSecret, IPC.compSecretReveal, IPC.compNpm, IPC.compInstall, IPC.windowPlan, IPC.marketSearch]) assert.ok(closed.includes(channel), channel);
  for (const channel of closed) await assert.rejects(invokeFrom(PANEL, channel, 'test.clock'), /不允许调用/, channel);
  assert.equal(refused.length, closed.length);
  assert.ok(fs.existsSync(path.join(r.dir, 'test.clock', 'component.json')));
  await invokeFrom(PANEL, IPC.storageCall, 'test.clock', { op: 'set', key: 'k', value: 1 });
  assert.equal(await invokeFrom(PANEL, IPC.storageCall, 'test.clock', { op: 'get', key: 'k' }), 1);
  await assert.rejects(invokeFrom(PANEL, IPC.storageCall, 'test.b', { op: 'set', key: 'k', value: 2 }), /不允许调用/);
  await assert.rejects(invokeFrom(PANEL, IPC.storageCall, 'test.b', { op: 'get', key: 'k' }), /不允许调用/);
  assert.equal(await invoke(IPC.storageCall, 'test.b', { op: 'get', key: 'k' }), null);
});

test('正在提供的功能：开着且声明了面板的组件有 panel；键盘上的部件是它的类别；关着的、要的服务没开的没有', async t => {
  const r = rig(t, dir => {
    writeComponent(dir, 'test.kb', { kind: 'panel', page: undefined, panel: { page: 'panel.js', width: 480, height: 200, slots: ['sidepage'] } });
    writeComponent(dir, 'test.both', { kind: 'service', page: undefined, main: 'main.js', provides: ['clock'], panel: { page: 'panel.js', width: 480, height: 200 } });
    writeComponent(dir, 'test.side');
    writeComponent(dir, 'test.needy', { requires: ['cloud'] });
    writeComponent(dir, 'test.off', { kind: 'panel', page: undefined, panel: { page: 'panel.js', width: 480, height: 200 } });
  });
  r.manager.start();
  assert.deepEqual(await invoke(IPC.compSet, { kind: 'on', id: 'test.off', on: false }), { ok: true });
  const features = Object.fromEntries((await r.list()).rows.map(row => [row.id, row.features]));
  assert.deepEqual(features, {
    'test.both': ['panel'], 'test.kb': ['panel'], 'test.needy': undefined, 'test.off': undefined, 'test.side': ['sidepage'],
  });
});

test('只在这次运行加载的组件：不在列表里，卸载不了，组件进程照常加载它', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-manager-extra-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const extra = writeComponent(root, 'dev.display', { kind: 'service', page: undefined, main: 'main.js', provides: ['panels'] });
  const r = rig(t, dir => writeComponent(dir, 'test.a'), [extra]);
  r.manager.start();
  assert.deepEqual((await r.list()).rows.map(row => row.id), ['test.a']);
  assert.deepEqual((await r.manager.mainComponents()).map(c => c.id), ['dev.display']);
  assert.deepEqual(r.manager.store.providers('panels', r.settings()), ['dev.display']);
  const removed = await invoke(IPC.compRemove, 'dev.display') as { ok: boolean };
  assert.equal(removed.ok, false);
  assert.ok(fs.existsSync(path.join(extra, 'component.json')));
  assert.ok(!r.settings().order.includes('dev.display'));
});
