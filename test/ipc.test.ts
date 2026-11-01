import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createIpc, HEARD_CHANNEL, OWN_CHANNEL, OWN_COMPONENT, OWN_REMOTE, POLICY, type Channel, type Ipc, type IpcEvent, type IpcHandler } from '../src/main/ipc.ts';
import { SENDER_KINDS, Senders, type SenderKind } from '../src/main/senders.ts';
import { IPC, PAGE_IPC } from '../src/shared/types.ts';

// 通道的键：IPC 和 PAGE_IPC 的键合在一起
type Name = Channel;
const NAMES = [...new Set([...Object.keys(IPC), ...Object.keys(PAGE_IPC)])] as Name[];

// 测试里的窗口(webContents 的 id)和各自加载的组件；面板页面是面板 a.clock 的；STRANGER 没登记
const ID: Record<SenderKind, number> = { window: 1, media: 2, panel: 4 };
const OWN: Record<SenderKind, string> = { window: 'a.any', media: 'a.tts', panel: 'a.clock' };
// 媒体页面、面板页面各自的组件够得着的远程服务
const REMOTE: Record<Exclude<SenderKind, 'window'>, string> = { media: 'usage', panel: 'weather' };
// 另一块面板 a.shell 的页面：它加载的组件和够得着的远程服务
const SHELL = 3;
const SHELL_ID = 'a.shell';
const SHELL_REMOTE = 'keyboard';
const STRANGER = 9;

interface Rig {
  ipc: Ipc;
  senders: Senders;
  warnings: string[];                 // 写出的警告日志
  clock: { now: number };             // 限频用的时间(毫秒)
  // 以 sender 这个窗口的身份发一条消息；subframe 为 true 时消息来自页面里的子框架
  fire(channel: string, sender: number, args?: unknown[], subframe?: boolean): unknown;
}

function rig(): Rig {
  const senders = new Senders();
  senders.add(ID.window, 'window');
  senders.add(ID.media, 'media', [OWN.media], [REMOTE.media]);
  senders.addPanel(SHELL, SHELL_ID, [SHELL_ID], [SHELL_REMOTE]);
  senders.addPanel(ID.panel, OWN.panel, [OWN.panel], [REMOTE.panel]);
  const handlers = new Map<string, IpcHandler>();
  const warnings: string[] = [];
  const clock = { now: 5_000_000 };
  const ipc = createIpc({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => handlers.set(channel, fn) },
    senders, now: () => clock.now,
    log: (text, level) => warnings.push(`${level ?? 'info'}: ${text}`),
  });
  const fire: Rig['fire'] = (channel, sender, args = [], subframe = false) => {
    const fn = handlers.get(channel);
    assert.ok(fn, channel);
    const frame = {};
    const e: IpcEvent = { sender: { id: sender, mainFrame: frame }, senderFrame: subframe ? {} : frame };
    return fn(e, ...args);
  };
  return { ipc, senders, warnings, clock, fire };
}

// 每个通道给了谁(按类别的固定顺序，逗号分隔；空 = 页面不能发)
const GRANTED: Record<string, readonly Name[]> = {
  '': ['settingsEvent', 'compListEvent', 'busEvent', 'updateEvent', 'windowPlanEvent', 'logEvent', 'closeAsk', 'statsEvent', 'relayEvent', 'lookEvent', 'visibleEvent'],
  'window': [
    'init', 'language', 'setApp',
    'compList', 'compPick', 'compInstall', 'compRemove', 'compRemoveBroken', 'compSet', 'compSecret', 'compSecretReveal', 'compDevAdd', 'compOpenFolder', 'compHostRestart', 'compNpm',
    'marketSearch', 'marketInfo', 'windowPlan',
    'updateState', 'updateCheck', 'updateInstall',
    'winMinimize', 'winMaximize', 'winClose', 'closeAnswer', 'closeHandler',
    'dirList', 'dirMake', 'openDataDir', 'openExternal', 'logList',
  ],
  'panel': ['setDark', 'hide'],
  'media,panel': ['plan', 'look', 'relayUse', 'relayCall', 'busListen'],
  'window,media,panel': ['storageCall', 'busSend', 'logWrite'],
};

test('通道名：PAGE_IPC 和 IPC 同名的键是同一个通道，不同名的键各是各的通道', () => {
  const ipcNames: Record<string, string> = IPC;
  const pageNames: Record<string, string> = PAGE_IPC;
  const shared = Object.keys(pageNames).filter(k => k in ipcNames);
  assert.deepEqual(shared.sort(), ['busEvent', 'busListen', 'busSend', 'logWrite', 'relayCall', 'relayEvent', 'relayUse', 'storageCall']);
  for (const k of shared) assert.equal(pageNames[k], ipcNames[k], k);
  const channels = NAMES.map(n => pageNames[n] ?? ipcNames[n]);
  assert.ok(channels.every(c => typeof c === 'string' && c.length > 0));
  assert.equal(new Set(channels).size, NAMES.length);
});

test('策略表：IPC 和 PAGE_IPC 的每个通道都有一条，给的页面和约定的一致', () => {
  assert.deepEqual(Object.keys(POLICY).sort(), [...NAMES].sort());
  assert.deepEqual(Object.values(GRANTED).flat().sort(), [...NAMES].sort());
  for (const [kinds, names] of Object.entries(GRANTED)) {
    for (const name of names) assert.equal(SENDER_KINDS.filter(k => POLICY[name].includes(k)).join(','), kinds, name);
  }
  assert.deepEqual([...OWN_COMPONENT].sort(), [IPC.logWrite, IPC.storageCall].sort());
  assert.deepEqual([...OWN_CHANNEL], [IPC.busSend]);
  assert.deepEqual([...HEARD_CHANNEL], [IPC.busListen]);
  assert.deepEqual([...OWN_REMOTE].sort(), [IPC.relayCall, IPC.relayUse].sort());
});

test('每个通道对每种页面：在名单里的处理，不在的和没登记的窗口不处理', () => {
  for (const name of NAMES) {
    const r = rig();
    const calls: string[] = [];
    r.ipc.handle(`h:${name}`, POLICY[name], () => calls.push('handle'));
    r.ipc.on(`o:${name}`, POLICY[name], () => { calls.push('on'); });
    // 带组件 id、总线频道、远程服务名的通道在后面的测试里；这里的通道名不在 OWN_COMPONENT、OWN_CHANNEL、OWN_REMOTE 里，参数不影响结果
    for (const kind of SENDER_KINDS) {
      calls.length = 0;
      const ok = POLICY[name].includes(kind);
      if (ok) r.fire(`h:${name}`, ID[kind]);
      else assert.throws(() => r.fire(`h:${name}`, ID[kind]), /不允许调用/, `${name} ${kind}`);
      assert.doesNotThrow(() => r.fire(`o:${name}`, ID[kind]));
      assert.deepEqual(calls, ok ? ['handle', 'on'] : [], `${name} ${kind}`);
    }
    calls.length = 0;
    assert.throws(() => r.fire(`h:${name}`, STRANGER), /不允许调用/, name);
    r.fire(`o:${name}`, STRANGER);
    assert.deepEqual(calls, [], name);
  }
});

test('处理的调用：参数和消息原样交给处理函数，返回值原样返回', async () => {
  const r = rig();
  const seen: unknown[][] = [];
  r.ipc.handle('h', ['window'], (e, ...args) => {
    seen.push([e.sender.id, ...args]);
    return Promise.resolve('done');
  });
  r.ipc.on('o', ['window'], (e, ...args) => { seen.push([e.sender.id, ...args]); });
  assert.equal(await r.fire('h', ID.window, ['a', 2]), 'done');
  assert.equal(r.fire('o', ID.window, [{ k: 1 }]), undefined);
  assert.deepEqual(seen, [[ID.window, 'a', 2], [ID.window, { k: 1 }]]);
  assert.deepEqual(r.warnings, []);
});

test('不是页面主框架发来的消息不处理', () => {
  const r = rig();
  let calls = 0;
  r.ipc.handle('h', SENDER_KINDS, () => ++calls);
  r.ipc.on('o', SENDER_KINDS, () => { calls++; });
  for (const kind of SENDER_KINDS) {
    assert.throws(() => r.fire('h', ID[kind], [], true), /不允许调用/, kind);
    r.fire('o', ID[kind], [], true);
  }
  assert.equal(calls, 0);
  r.fire('h', SHELL);
  r.fire('o', SHELL);
  assert.equal(calls, 2);
  assert.equal(r.warnings.filter(w => w.includes('main frame')).length, 6);
});

test('组件数据和写日志：主窗口用哪个组件 id 都行，媒体页面、面板页面只能用自己加载的', () => {
  const r = rig();
  const got: unknown[] = [];
  r.ipc.handle(IPC.storageCall, POLICY.storageCall, (_e, id) => got.push(id));
  r.ipc.on(IPC.logWrite, POLICY.logWrite, (_e, id) => { got.push(id); });
  const both = (sender: number, id: unknown): boolean => {
    got.length = 0;
    let threw = false;
    try {
      r.fire(IPC.storageCall, sender, [id, { op: 'get', key: 'k' }]);
    } catch (e) {
      assert.match(String(e), /不允许调用/);
      threw = true;
    }
    r.fire(IPC.logWrite, sender, [id, 'text']);
    assert.deepEqual(got, threw ? [] : [id, id]);
    return !threw;
  };
  assert.deepEqual([both(ID.window, OWN.media), both(ID.window, SHELL_ID), both(ID.window, 'a.none'), both(ID.window, 5)], [true, true, true, true]);
  assert.deepEqual([both(ID.media, OWN.media), both(ID.media, SHELL_ID), both(ID.media, 'a.none')], [true, false, false]);
  assert.deepEqual([both(SHELL, SHELL_ID), both(SHELL, OWN.media), both(SHELL, undefined), both(SHELL, [SHELL_ID])], [true, false, false, false]);
  assert.deepEqual([both(ID.panel, OWN.panel), both(ID.panel, SHELL_ID), both(ID.panel, OWN.media), both(ID.panel, 'a.none'), both(ID.panel, undefined)], [true, false, false, false, false]);
  assert.equal(both(STRANGER, SHELL_ID), false);
  // 加载列表变了以后按新的列表
  r.senders.addPanel(SHELL, SHELL_ID, ['a.keys'], []);
  assert.deepEqual([both(SHELL, SHELL_ID), both(SHELL, 'a.keys')], [false, true]);
  // 面板的计划变了以后按新的计划；别的面板的页面不受影响
  r.senders.addPanel(5, 'a.notes', ['a.notes'], []);
  r.senders.addPanel(ID.panel, OWN.panel, [OWN.panel, 'a.part'], []);
  assert.deepEqual([both(ID.panel, 'a.part'), both(ID.panel, 'a.notes'), both(5, 'a.notes'), both(5, 'a.part')], [true, false, true, false]);
  // 窗口销毁后不处理
  r.senders.remove(ID.media);
  assert.equal(both(ID.media, OWN.media), false);
  // 别的通道第一个参数不当组件 id 看
  r.ipc.handle('other', ['panel'], (_e, id) => got.push(id));
  got.length = 0;
  r.fire('other', SHELL, ['a.none']);
  assert.deepEqual(got, ['a.none']);
});

test('总线：主窗口发哪个频道都行，媒体页面、面板页面只能发自己组件的频道；数据原样交给处理函数', () => {
  const r = rig();
  const got: unknown[][] = [];
  r.ipc.on(IPC.busSend, POLICY.busSend, (e, channel, data) => { got.push([e.sender.id, channel, data]); });
  const sent = (sender: number, channel: unknown): boolean => {
    got.length = 0;
    r.fire(IPC.busSend, sender, [channel, { n: 1 }]);
    if (got.length) assert.deepEqual(got, [[sender, channel, { n: 1 }]]);
    return got.length > 0;
  };
  assert.deepEqual([sent(ID.window, `${OWN.media}/mic`), sent(ID.window, 'core/component-removed'), sent(ID.window, 'free'), sent(ID.window, 5)], [true, true, true, true]);
  assert.deepEqual([sent(ID.media, `${OWN.media}/pcm`), sent(ID.media, `${SHELL_ID}/x`), sent(ID.media, 'core/component-removed'), sent(ID.media, OWN.media)], [true, false, false, false]);
  assert.deepEqual([sent(SHELL, `${SHELL_ID}/x`), sent(SHELL, `${OWN.media}/mic`), sent(SHELL, 'core/component-removed'), sent(SHELL, undefined)], [true, false, false, false]);
  assert.deepEqual([sent(ID.panel, `${OWN.panel}/x`), sent(ID.panel, `${SHELL_ID}/x`), sent(ID.panel, 'core/component-removed'), sent(ID.panel, OWN.panel)], [true, false, false, false]);
  assert.equal(sent(STRANGER, `${SHELL_ID}/x`), false);
  assert.deepEqual(r.warnings, [
    `warn: ipc ${IPC.busSend} refused: bus channel does not start with a component id loaded on the media page`,
    `warn: ipc ${IPC.busSend} refused: bus channel does not start with a component id loaded on the panel page`,
    `warn: ipc ${IPC.busSend} refused: sender unknown is not allowed`,
  ]);
  // 加载列表变了以后按新的列表
  r.senders.addPanel(SHELL, SHELL_ID, [OWN.media], []);
  assert.deepEqual([sent(SHELL, `${SHELL_ID}/x`), sent(SHELL, `${OWN.media}/mic`)], [false, true]);
  // 别的通道第一个参数不当频道看
  r.ipc.on('other', ['panel'], (_e, channel) => { got.push([channel]); });
  got.length = 0;
  r.fire('other', SHELL, ['core/x']);
  assert.deepEqual(got, [['core/x']]);
});

test('登记总线频道：媒体页面、面板页面只能登记自己组件的频道和核心的通知，别的组件的频道(麦克风的 PCM、合成的音频)登记不了', () => {
  const r = rig();
  const got: unknown[][] = [];
  r.ipc.on(IPC.busListen, POLICY.busListen, (e, channel, on) => { got.push([e.sender.id, channel, on]); });
  const heard = (sender: number, channel: unknown, on = true): boolean => {
    got.length = 0;
    r.fire(IPC.busListen, sender, [channel, on]);
    if (got.length) assert.deepEqual(got, [[sender, channel, on]]);
    return got.length > 0;
  };
  assert.deepEqual([heard(ID.media, `${OWN.media}/play`), heard(ID.media, 'core/component-removed'), heard(ID.media, `${SHELL_ID}/x`), heard(ID.media, `${OWN.panel}/tick`)], [true, true, false, false]);
  assert.deepEqual([heard(ID.panel, `${OWN.panel}/tick`), heard(ID.panel, 'core/component-removed'), heard(ID.panel, `${OWN.media}/pcm`), heard(ID.panel, `${OWN.media}/play`), heard(ID.panel, `${SHELL_ID}/x`)], [true, true, false, false, false]);
  // 取消登记同样只认自己的频道；频道名不是字符串、没有「/」、只是组件 id 的都不认
  assert.deepEqual([heard(SHELL, `${SHELL_ID}/x`, false), heard(SHELL, `${OWN.media}/pcm`, false)], [true, false]);
  assert.deepEqual([heard(SHELL, undefined), heard(SHELL, 5), heard(SHELL, SHELL_ID), heard(SHELL, 'free'), heard(SHELL, 'core'), heard(SHELL, `/${SHELL_ID}/x`)], [false, false, false, false, false, false]);
  assert.equal(heard(STRANGER, `${SHELL_ID}/x`), false);
  // 主窗口不登记(全收)
  assert.equal(heard(ID.window, `${SHELL_ID}/x`), false);
  assert.deepEqual(r.warnings, [
    `warn: ipc ${IPC.busListen} refused: bus channel belongs to a component that is not loaded on the media page`,
    `warn: ipc ${IPC.busListen} refused: bus channel belongs to a component that is not loaded on the panel page`,
    `warn: ipc ${IPC.busListen} refused: sender unknown is not allowed`,
    `warn: ipc ${IPC.busListen} refused: sender window is not allowed`,
  ]);
  // 加载列表变了以后按新的列表
  r.senders.addPanel(SHELL, SHELL_ID, [OWN.media], []);
  assert.deepEqual([heard(SHELL, `${SHELL_ID}/x`), heard(SHELL, `${OWN.media}/pcm`)], [false, true]);
});

test('远程服务：媒体页面、面板页面只能订阅、调用自己的组件够得着的名字；主窗口不能调；参数原样交给处理函数', () => {
  const r = rig();
  const got: unknown[][] = [];
  r.ipc.handle(IPC.relayUse, POLICY.relayUse, (e, ...args) => got.push([e.sender.id, ...args]));
  r.ipc.handle(IPC.relayCall, POLICY.relayCall, (e, ...args) => got.push([e.sender.id, ...args]));
  // 订阅和调用各试一次；两个通道的结果要一样
  const both = (sender: number, name: unknown): boolean => {
    got.length = 0;
    const tried = [[IPC.relayUse, [name, true]], [IPC.relayCall, [name, 'act', [{ kind: 'send' }], false]]] as const;
    const passed = tried.map(([channel, args]) => {
      try {
        r.fire(channel, sender, [...args]);
        return true;
      } catch (e) {
        assert.match(String(e), /不允许调用/);
        return false;
      }
    });
    assert.equal(passed[0], passed[1]);
    assert.deepEqual(got, passed[0] ? [[sender, name, true], [sender, name, 'act', [{ kind: 'send' }], false]] : []);
    return passed[0] === true;
  };
  assert.deepEqual([both(SHELL, SHELL_REMOTE), both(SHELL, REMOTE.media), both(SHELL, 'panels')], [true, false, false]);
  assert.deepEqual([both(ID.media, REMOTE.media), both(ID.media, SHELL_REMOTE)], [true, false]);
  assert.deepEqual([both(ID.panel, REMOTE.panel), both(ID.panel, SHELL_REMOTE), both(ID.panel, 'panels'), both(ID.panel, OWN.panel)], [true, false, false, false]);
  // 名字不是字符串、拿组件 id 当名字
  assert.deepEqual([both(SHELL, undefined), both(SHELL, [SHELL_REMOTE]), both(SHELL, SHELL_ID)], [false, false, false]);
  // 主窗口和没登记的窗口
  assert.deepEqual([both(ID.window, SHELL_REMOTE), both(STRANGER, SHELL_REMOTE)], [false, false]);
  assert.deepEqual(r.warnings, [
    `warn: ipc ${IPC.relayUse} refused: remote service is not declared by a component loaded on the panel page`,
    `warn: ipc ${IPC.relayCall} refused: remote service is not declared by a component loaded on the panel page`,
    `warn: ipc ${IPC.relayUse} refused: remote service is not declared by a component loaded on the media page`,
    `warn: ipc ${IPC.relayCall} refused: remote service is not declared by a component loaded on the media page`,
    `warn: ipc ${IPC.relayUse} refused: sender window is not allowed`,
    `warn: ipc ${IPC.relayCall} refused: sender window is not allowed`,
    `warn: ipc ${IPC.relayUse} refused: sender unknown is not allowed`,
    `warn: ipc ${IPC.relayCall} refused: sender unknown is not allowed`,
  ]);
  // 加载列表变了以后按新的列表
  r.senders.addPanel(SHELL, SHELL_ID, [SHELL_ID], [REMOTE.media]);
  assert.deepEqual([both(SHELL, SHELL_REMOTE), both(SHELL, REMOTE.media)], [false, true]);
  // 不是主框架发的不处理
  assert.throws(() => r.fire(IPC.relayUse, SHELL, [REMOTE.media, true], true), /不允许调用/);
  // 别的通道第一个参数不当服务名看
  r.ipc.handle('other', ['panel'], (_e, name) => got.push([name]));
  got.length = 0;
  r.fire('other', SHELL, ['panels']);
  assert.deepEqual(got, [['panels']]);
});

test('不处理时写一行警告；同一个通道的同一个原因 10 秒内只写一次', () => {
  const r = rig();
  r.ipc.handle(IPC.compRemove, POLICY.compRemove, () => undefined);
  r.ipc.on(IPC.winClose, POLICY.winClose, () => undefined);
  r.ipc.handle(IPC.storageCall, POLICY.storageCall, () => undefined);
  const refuse = (channel: string, sender: number, args: unknown[] = []): void => {
    try {
      r.fire(channel, sender, args);
    } catch { /* handle 的拒绝 */ }
  };
  for (let i = 0; i < 5; i++) refuse(IPC.compRemove, SHELL, ['a.shell']);
  assert.deepEqual(r.warnings, [`warn: ipc ${IPC.compRemove} refused: sender panel is not allowed`]);
  // 别的原因、别的通道各算各的
  refuse(IPC.compRemove, ID.media);
  refuse(IPC.compRemove, STRANGER);
  refuse(IPC.winClose, SHELL);
  refuse(IPC.storageCall, SHELL, ['a.none']);
  refuse(IPC.storageCall, SHELL, ['a.other']);
  assert.deepEqual(r.warnings.slice(1), [
    `warn: ipc ${IPC.compRemove} refused: sender media is not allowed`,
    `warn: ipc ${IPC.compRemove} refused: sender unknown is not allowed`,
    `warn: ipc ${IPC.winClose} refused: sender panel is not allowed`,
    `warn: ipc ${IPC.storageCall} refused: component id is not loaded on the panel page`,
  ]);
  r.clock.now += 9_999;
  refuse(IPC.compRemove, SHELL);
  assert.equal(r.warnings.length, 5);
  r.clock.now += 1;
  refuse(IPC.compRemove, SHELL);
  refuse(IPC.compRemove, SHELL);
  assert.equal(r.warnings.length, 6);
  assert.equal(r.warnings[5], r.warnings[0]);
  // 处理了的调用不写
  r.fire(IPC.compRemove, ID.window, ['a.shell']);
  assert.equal(r.warnings.length, 6);
});

const ROOT = path.join(import.meta.dirname, '..');
const read = (...parts: string[]): string => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('主进程的源码：页面能调的通道都经 ipc 注册，各用策略表里自己的那一条，注册方式和 preload 的调用方式对得上', () => {
  const dir = path.join(ROOT, 'src', 'main');
  const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.ts'));
  const registered = new Map<string, string>();   // 通道的键 → handle / on
  for (const f of files) {
    const source = fs.readFileSync(path.join(dir, f), 'utf8');
    // 直接用 electron 的 ipcMain 注册(ipc.ts 里注入进来的 deps.ipcMain 不算)
    assert.doesNotMatch(source, /(?<![.\w])ipcMain\s*\.\s*(handle|on|once|handleOnce)\b/, f);
    for (const [, how = '', name = '', policy = ''] of source.matchAll(/\bipc\.(handle|on)\(\s*(?:PAGE_)?IPC\.(\w+),\s*([\w.]+)/g)) {
      assert.equal(policy, `POLICY.${name}`, `${f}: ${name}`);
      assert.ok(!registered.has(name), `${f}: ${name} registered twice`);
      registered.set(name, how);
    }
  }
  const callable = NAMES.filter(n => POLICY[n].length > 0);
  assert.deepEqual([...registered.keys()].sort(), [...callable].sort());
  // 两个 preload：invoke 的通道用 handle 注册，send 的用 on；两边都用的通道调用方式一样
  const calls = new Map<string, string>();
  const called = (file: string, table: string): string[] => {
    const names: string[] = [];
    for (const [, how = '', name = ''] of read('src', 'preload', file).matchAll(new RegExp(`ipcRenderer\\.(invoke|send)\\(${table}\\.(\\w+)`, 'g'))) {
      const way = how === 'invoke' ? 'handle' : 'on';
      assert.equal(calls.get(name) ?? way, way, `${file}: ${name}`);
      calls.set(name, way);
      names.push(name);
    }
    return names;
  };
  called('preload.ts', 'IPC');
  const narrow = called('page.ts', 'PAGE_IPC');
  assert.deepEqual([...calls].sort(), [...registered].sort());
  // 窄 preload：只用 PAGE_IPC 里的通道(页面能发的每一个都用到)，不直接用 IPC 的通道名
  assert.deepEqual([...narrow].sort(), Object.keys(PAGE_IPC).filter(n => POLICY[n as Name].length > 0).sort());
  assert.doesNotMatch(read('src', 'preload', 'page.ts'), /(?<![\w.])IPC\./);
});

test('窄 preload：window.fox 上只有 PageApi 的接口，没有组件管理、应用设置、窗口控制、目录、市场、更新的接口', () => {
  const source = read('src', 'preload', 'page.ts');
  const body = /const fox: PageApi = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? assert.fail('page.ts 里没有 fox 对象');
  const keys = [...body.matchAll(/^ {2}(\w+):/gm)].flatMap(m => (m[1] ? [m[1]] : []));
  assert.deepEqual(keys.sort(), [
    'busListen', 'busSend', 'hide', 'logWrite', 'look', 'onBus', 'onLook', 'onRelay', 'onVisible', 'plan', 'relayCall', 'relayUse', 'setDark', 'storageCall',
  ]);
  assert.match(source, /contextBridge\.exposeInMainWorld\('fox', fox\);/);
  assert.equal([...source.matchAll(/exposeInMainWorld/g)].length, 1);
});

// 源码里名字是 name 的顶层函数(function 声明)的整段
function functionSource(source: string, name: string): string {
  const start = source.search(new RegExp(`^(async )?function ${name}[(]`, 'm'));
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, name);
  return source.slice(start, end);
}

test('主进程的源码：窗口只在三个文件里建；main.ts 把主窗口、媒体页面、面板页面登记成对应的页面、带上这一页加载的组件 id，启动时装上会话的限制', () => {
  const dir = path.join(ROOT, 'src', 'main');
  const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.ts'));
  const makers = files.filter(f => /\bnew BrowserWindow\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(makers.sort(), ['pages.ts', 'panel-window.ts', 'window.ts']);
  // 逻辑文件不导入 electron：面板页面、页面总线、登记表、策略表、远程服务
  for (const f of ['panels.ts', 'page-bus.ts', 'senders.ts', 'ipc.ts', 'relay.ts', 'payload.ts']) assert.doesNotMatch(read('src', 'main', f), /from 'electron'/, f);

  const main = read('src', 'main', 'main.ts');
  // 主窗口和媒体页面各自登记的类别；媒体页面用窄 preload。窗口都是登记了的：main.ts 自己不建窗口、不单独加页面限制
  assert.match(main, /new MainWindow\(\{[^;]*?\bopened: wc => adoptPage\(wc, 'window'\),/);
  assert.match(main, /new MediaPage\(MEDIA_PAGE, PAGE_PRELOAD, wc => adoptPage\(wc, 'media'\)\)/);
  assert.equal([...main.matchAll(/\badoptPage\(wc, /g)].length, 2);
  assert.doesNotMatch(main, /FOXPANEL_PAGE|openDebug|debugPage|KEYBOARD_PAGE|pagePlan|[Oo]ffscreen|\blockDown\b/);
  // 登记时带的组件 id：主窗口不带，媒体页面是它的计划里的组件(页面代码和服务)和计划里的远程服务名
  const adopted = functionSource(main, 'adoptPage');
  assert.match(adopted, /const plan = kind === 'media' \? mediaPlan\(\) : null;/);
  assert.match(adopted, /\badopt\(senders, wc, kind, plan \? mediaIds\(plan\) : \[\], plan\?\.remotes \?\? \[\]\);/);
  assert.match(main, /const mediaIds = \(plan: MediaPlan\): string\[\] => \[\.\.\.plan\.components, \.\.\.plan\.services\]\.map\(c => c\.id\);/);
  // 页面重新加载或销毁时清掉它登记的总线频道
  assert.match(adopted, /wc\.on\('did-start-navigation', details => \{\n    if \(details\.isMainFrame && !details\.isSameDocument\) pageBus\.drop\(id\);/);
  assert.match(adopted, /wc\.once\('destroyed', \(\) => pageBus\.drop\(id\)\);/);
  // 面板页面：用窄 preload 建窗口，登记成面板页面(带面板 id、计划里的组件 id 和远程服务)，窗口没了时注销；只有生效的显示方能开
  const panelDeps = functionSource(main, 'newPanels');
  assert.match(panelDeps, /createWindow: \(spec, events\) => createPanelWindow\(spec, PAGE_PRELOAD, /);
  assert.match(panelDeps, /adopt: \(page, plan\) => senders\.addPanel\(page, plan\.id, planIds\(plan\), plan\.remotes\),/);
  assert.match(panelDeps, /dropped: page => \{\n\s+senders\.remove\(page\);\n\s+pageBus\.drop\(page\);/);
  assert.match(panelDeps, /restarted: page => pageBus\.drop\(page\),/);
  assert.match(panelDeps, /display: \(\) => components\.store\.providers\('panels', settings\.components\)\[0\],/);
  // 句柄复制用适配文件里的 kernel32 调用；保留期用真的计时(返回取消函数)；面板目录变了推给组件进程，出错的页面变了让组件列表重发
  assert.match(panelDeps, /\n    openProcess, duplicate, closeHandle,\n/);
  assert.match(main, /import \{ closeHandle, createPanelWindow, duplicate, openProcess \} from '\.\/panel-window\.ts';/);
  assert.match(panelDeps, /setTimer: \(fn, ms\) => \{\n\s+const timer = setTimeout\(fn, ms\);\n\s+return \(\) => clearTimeout\(timer\);\n\s+\},/);
  assert.match(panelDeps, /listed: list => host\.panels\(\[\.\.\.list\]\),/);
  assert.match(panelDeps, /failed: \(\) => components\.hostChanged\(\),/);
  assert.match(functionSource(main, 'newComponents'), /pageErrors: \(\) => panels\.errors,/);
  assert.match(main, /const PAGE_PRELOAD = path\.join\(DIST, 'preload-page\.cjs'\);/);
  assert.equal([...main.matchAll(/\bPAGE_PRELOAD\b/g)].length, 3);
  // 面板窗口的适配：沙箱、上下文隔离、页面限制
  const adapter = read('src', 'main', 'panel-window.ts');
  assert.match(adapter, /preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false,/);
  assert.match(adapter, /\blockDown\(wc\);/);
  // 组件变了：媒体页面的组件 id 和远程服务名跟上它的新计划，面板页面、远程服务生效的提供方、应用信息都跟上
  const changed = functionSource(main, 'componentsChanged');
  assert.match(changed, /const plan = mediaPlan\(\);\n  senders\.loadMedia\(mediaIds\(plan\), plan\.remotes\);/);
  for (const line of ['panels.sync(panelSpecs());', 'relay.sync();', 'appBridge.refresh();']) assert.ok(changed.includes(`\n  ${line}\n`), line);
  // 媒体页面按它的计划加载和重载
  assert.match(functionSource(main, 'loadHost'), /media\.sync\(mediaPlan\(\)\);/);
  // 开发用的显示方：未打包的程序带环境变量 FOXPANEL_PANELS=1 启动时才当作这次运行的组件加载(判断在 src/main/dev.ts)
  assert.match(functionSource(main, 'newComponents'), /extra: devComponents\(process\.env, app\.isPackaged, DEV_DISPLAY\),/);
  assert.match(main, /const DEV_DISPLAY = path\.join\(DIST, 'dev', 'display-desktop'\);/);
  // 组件进程：退出时撤掉它提供的远程服务，登记变了时重新推应用信息；它发来的远程服务消息和通用请求各交给对应的部分
  const hostDeps = functionSource(main, 'newHost');
  assert.match(hostDeps, /gone: h => \{\n\s+relay\.hostGone\(h\);\n\s+panels\.hostGone\(h\);/);
  assert.match(hostDeps, /changed: \(\) => \{\n\s+appBridge\.refresh\(\);/);
  for (const line of ['info: () => appBridge.info(),', 'relay: (m, h) => relay.message(m, h),', 'request: (m, h) => appBridge.message(m, h),', 'panels: (m, h) => panels.message(m, h),', 'panelList: () => panels.list,']) assert.ok(hostDeps.includes(line), line);
  // 界面语言变了：应用信息、面板页面和媒体页面的外观跟上
  assert.match(main, /ipc\.handle\(IPC\.language, POLICY\.language, \(_e, lang\) => \{[^}]*?\n    appBridge\.refresh\(\);\n    pushLook\(\);/);
  // 深色：存进设置，变了才通知；外观和页面手里的一样时不发
  assert.match(main, /ipc\.on\(PAGE_IPC\.setDark, POLICY\.setDark, \(_e, on\) => \{\n    const dark = on === true;\n    if \(settings\.panels\.dark === dark\) return;\n    settings\.panels = \{ dark \};\n    saveConfig\(\);\n    mainWindow\.send\(IPC\.settingsEvent, settings\);\n    pushLook\(\);/);
  const look = functionSource(main, 'pushLook');
  assert.match(look, /if \(sig === lookSig\) return;\n  lookSig = sig;\n  panels\.sendAll\(PAGE_IPC\.lookEvent, look\);\n  media\.webContents\?\.send\(PAGE_IPC\.lookEvent, look\);/);
  assert.match(main, /const pageLook = \(\): PageLook => \(\{ dark: settings\.panels\.dark, locale: uiLocale\(\) \}\);/);
  // 页面取计划：媒体页面拿媒体页面的，面板页面拿自己那一块的，别的拿不到
  assert.match(main, /ipc\.handle\(PAGE_IPC\.plan, POLICY\.plan, \(e\): PanelPlan \| MediaPlan => \{\n    if \(senders\.get\(e\.sender\.id\)\?\.kind === 'media'\) return mediaPlan\(\);\n    const plan = panels\.planOf\(e\.sender\.id\);\n    if \(!plan\) throw new Error/);
  // 面板页面请显示方收起自己：只能收起自己这一块，调用者是核心填的面板 id
  assert.match(main, /if \(info\?\.kind === 'panel'\) relay\.tell\('panels', 'open', \[info\.panel, false\], \{ component: info\.panel, where: 'panel' \}\);/);
  // 远程服务的状态只发给登记着的页面，页面一侧的通道由 ServiceRelay 经 ipc 注册
  assert.match(main, /relay\.registerIpc\(ipc\);/);
  assert.match(functionSource(main, 'newRelay'), /\bsenders,\n/);
  // 会话的限制在开任何窗口之前装上
  const boot = functionSource(main, 'boot');
  const limit = boot.indexOf('limitPermissions(session.defaultSession, senders);');
  assert.ok(limit >= 0 && limit < boot.indexOf('mainWindow.open()') && limit < boot.indexOf('loadHost()'));
  // 页面发的总线消息不发回给它自己；媒体页面、面板页面只收登记了的频道，主窗口全收
  const toPages = functionSource(main, 'busToPages');
  assert.match(toPages, /pageBus\.deliver\(channel, data, from\);/);
  assert.match(toPages, /if \(mainWindow\.webContents\?\.id !== from\) mainWindow\.send\(IPC\.busEvent, channel, data\);/);
  assert.doesNotMatch(toPages, /componentPages/);
  assert.match(main, /busToPages\(channel, data, e\.sender\.id\);/);
  // 页面发的总线消息：核心的频道和太大的不转发；登记频道交给页面总线
  assert.match(main, /ipc\.on\(IPC\.busSend, POLICY\.busSend, \(e, channel, data\) => \{\n    if \(!pageBus\.accepts\(channel, data\)\) return;\n    host\.bus\(channel, data\);/);
  assert.match(main, /ipc\.on\(IPC\.busListen, POLICY\.busListen, \(e, channel, on\) => pageBus\.listen\(e\.sender\.id, channel, on\)\);/);
});
