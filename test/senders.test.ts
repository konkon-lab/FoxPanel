import test from 'node:test';
import assert from 'node:assert/strict';
import { adopt, limitPermissions, lockDown, mayCheck, mayRequest, ownsChannel, ownsComponent, Senders, usesRemote, type SenderInfo } from '../src/main/senders.ts';

const ids = (info: SenderInfo | undefined): string[] | null => (info && info.kind !== 'window' ? [...info.ids] : null);
const remotes = (info: SenderInfo | undefined): string[] | null => (info && info.kind !== 'window' ? [...info.remotes] : null);

test('登记：每个窗口记着是哪种页面，媒体页面和面板页面带着加载的组件 id；没登记的查不到', () => {
  const s = new Senders();
  s.add(1, 'window');
  s.add(2, 'media', ['a.tts', 'a.asr']);
  s.addPanel(3, 'a.shell', ['a.shell'], []);
  assert.deepEqual(s.get(1), { kind: 'window' });
  assert.deepEqual([s.get(2)?.kind, ids(s.get(2))], ['media', ['a.tts', 'a.asr']]);
  assert.deepEqual([s.get(3)?.kind, ids(s.get(3))], ['panel', ['a.shell']]);
  assert.equal(s.get(4), undefined);
  // 主窗口不带组件 id，给了也不记
  s.add(5, 'window', ['a.x']);
  assert.deepEqual(s.get(5), { kind: 'window' });
});

test('媒体页面的加载列表变了：媒体页面都换成新的组件 id，主窗口和面板页面不动；之后登记的用登记时给的', () => {
  const s = new Senders();
  s.add(1, 'window');
  s.add(2, 'media', ['a.tts']);
  s.add(4, 'media', ['a.tts']);
  s.addPanel(3, 'a.shell', ['a.shell'], []);
  s.loadMedia(['a.tts', 'a.asr']);
  assert.deepEqual([ids(s.get(2)), ids(s.get(4))], [['a.tts', 'a.asr'], ['a.tts', 'a.asr']]);
  assert.deepEqual(ids(s.get(3)), ['a.shell']);
  assert.deepEqual(s.get(1), { kind: 'window' });
  s.loadMedia([]);
  assert.deepEqual(ids(s.get(2)), []);
  s.add(6, 'media', ['a.other']);
  assert.deepEqual(ids(s.get(6)), ['a.other']);
});

test('注销：窗口销毁后查不到；同一个 id 可以重新登记成别的页面', () => {
  const s = new Senders();
  s.add(2, 'media', ['a.tts']);
  s.remove(2);
  assert.equal(s.get(2), undefined);
  s.remove(2);
  s.loadMedia(['a.tts']);
  assert.equal(s.get(2), undefined);
  s.addPanel(2, 'a.shell', ['a.shell'], []);
  assert.equal(s.get(2)?.kind, 'panel');
});

test('组件 id：主窗口都能用，媒体页面和面板页面只能用自己加载的', () => {
  const s = new Senders();
  s.add(1, 'window');
  s.add(2, 'media', ['a.tts']);
  s.addPanel(3, 'a.shell', ['a.shell'], []);
  const owns = (id: number, component: unknown): boolean => {
    const info = s.get(id);
    assert.ok(info);
    return ownsComponent(info, component);
  };
  assert.deepEqual([owns(1, 'a.tts'), owns(1, 'a.none'), owns(1, 5)], [true, true, true]);
  assert.deepEqual([owns(2, 'a.tts'), owns(2, 'a.shell'), owns(2, undefined)], [true, false, false]);
  assert.deepEqual([owns(3, 'a.shell'), owns(3, 'a.tts'), owns(3, ['a.shell'])], [true, false, false]);
  s.loadMedia(['a.asr']);
  assert.deepEqual([owns(2, 'a.tts'), owns(2, 'a.asr')], [false, true]);
});

test('总线频道：主窗口都能发，媒体页面和面板页面只能发以自己加载的组件 id 加「/」开头的', () => {
  const s = new Senders();
  s.add(1, 'window');
  s.add(2, 'media', ['a.asr']);
  s.addPanel(3, 'a.shell', ['a.shell', 'a.keys'], []);
  const owns = (id: number, channel: unknown): boolean => {
    const info = s.get(id);
    assert.ok(info);
    return ownsChannel(info, channel);
  };
  assert.deepEqual([owns(1, 'a.asr/mic'), owns(1, 'core/component-removed'), owns(1, 'anything'), owns(1, 5)], [true, true, true, true]);
  assert.deepEqual([owns(2, 'a.asr/pcm'), owns(2, 'a.asr/a/b'), owns(2, 'a.asr/')], [true, true, true]);
  // 别的组件的频道、核心的频道、只有组件 id、id 只是前缀的一部分、开头多一个「/」、空串
  assert.deepEqual(
    [owns(2, 'a.shell/x'), owns(2, 'core/component-removed'), owns(2, 'a.asr'), owns(2, 'a.asr2/pcm'), owns(2, 'a.as/r/pcm'), owns(2, '/a.asr/pcm'), owns(2, '')],
    [false, false, false, false, false, false, false],
  );
  // 不是字符串
  assert.deepEqual([owns(2, undefined), owns(2, ['a.asr/pcm']), owns(2, { toString: () => 'a.asr/pcm' })], [false, false, false]);
  assert.deepEqual([owns(3, 'a.shell/x'), owns(3, 'a.keys/x'), owns(3, 'a.asr/mic'), owns(3, 'core/x')], [true, true, false, false]);
  s.loadMedia(['a.tts']);
  assert.deepEqual([owns(2, 'a.asr/pcm'), owns(2, 'a.tts/play')], [false, true]);
});

test('远程服务：媒体页面和面板页面只能用登记时给的名字，媒体页面的加载列表变了跟着换；主窗口都用不了', () => {
  const s = new Senders();
  s.add(1, 'window', [], ['keyboard']);
  s.add(2, 'media', ['a.asr'], ['keyboard', 'usage']);
  s.addPanel(3, 'a.shell', ['a.shell', 'a.keys'], ['keyboard']);
  s.add(4, 'media', ['a.tts']);
  assert.deepEqual([s.get(1), remotes(s.get(2)), remotes(s.get(3)), remotes(s.get(4))], [{ kind: 'window' }, ['keyboard', 'usage'], ['keyboard'], []]);
  const uses = (id: number, name: unknown): boolean => {
    const info = s.get(id);
    assert.ok(info);
    return usesRemote(info, name);
  };
  assert.deepEqual([uses(1, 'keyboard'), uses(1, 'usage')], [false, false]);
  assert.deepEqual([uses(2, 'keyboard'), uses(2, 'usage'), uses(2, 'panels')], [true, true, false]);
  assert.deepEqual([uses(3, 'keyboard'), uses(3, 'usage'), uses(4, 'keyboard')], [true, false, false]);
  // 不是字符串、组件 id 不当服务名
  assert.deepEqual([uses(3, ['keyboard']), uses(3, undefined), uses(3, { toString: () => 'keyboard' }), uses(3, 'a.shell'), uses(3, '')], [false, false, false, false, false]);
  // 加载列表变了：媒体页面都换成新的名字；没给名字时一个都用不了
  s.loadMedia(['a.asr'], ['usage']);
  assert.deepEqual([remotes(s.get(2)), remotes(s.get(4)), remotes(s.get(3))], [['usage'], ['usage'], ['keyboard']]);
  assert.deepEqual([uses(2, 'keyboard'), uses(2, 'usage'), uses(4, 'usage')], [false, true, true]);
  s.loadMedia(['a.asr']);
  assert.deepEqual([ids(s.get(2)), remotes(s.get(2)), uses(2, 'usage')], [['a.asr'], [], false]);
});

test('权限：申请只给媒体页面的 media；查询给媒体页面和主窗口的 media；别的都不给', () => {
  const window: SenderInfo = { kind: 'window' };
  const media: SenderInfo = { kind: 'media', ids: new Set(), remotes: new Set() };
  const panel: SenderInfo = { kind: 'panel', panel: 'a.shell', ids: new Set(), remotes: new Set() };
  const all = [window, media, panel, undefined];
  assert.deepEqual(all.map(i => mayRequest(i, 'media')), [false, true, false, false]);
  assert.deepEqual(all.map(i => mayCheck(i, 'media')), [true, true, false, false]);
  const others = [
    'clipboard-read', 'clipboard-sanitized-write', 'speaker-selection', 'hid', 'serial', 'usb', 'geolocation', 'notifications',
    'fullscreen', 'pointerLock', 'openExternal', 'display-capture', 'midi', 'midiSysex', 'fileSystem', 'unknown',
  ];
  for (const p of others) {
    assert.deepEqual(all.map(i => mayRequest(i, p)), [false, false, false, false], p);
    assert.deepEqual(all.map(i => mayCheck(i, p)), [false, false, false, false], p);
  }
});

type Stop = { preventDefault(): void };
// 监听函数各自的参数不同：登记时不看参数类型
type Listener = (e: Stop & { isMainFrame: boolean }, ...args: never[]) => void;

// 假的 webContents：记下挂上的监听和开新窗口的处理函数；fire 触发一个事件，返回它有没有被拦下
class FakeContents {
  readonly id: number;
  url = 'fox://yanuo.shell-classic.panel/panel.html';
  openHandler: (() => { action: 'deny' }) | null = null;
  private readonly listeners = new Map<string, Listener>();

  constructor(id = 0) {
    this.id = id;
  }

  getURL(): string {
    return this.url;
  }

  on(event: string, fn: Listener): void {
    this.listeners.set(event, fn);
  }

  once(event: string, fn: Listener): void {
    this.listeners.set(event, fn);
  }

  // 挂了监听的事件
  get events(): string[] {
    return [...this.listeners.keys()].sort();
  }

  setWindowOpenHandler(fn: () => { action: 'deny' }): void {
    this.openHandler = fn;
  }

  rtcPolicy = '';
  setWebRTCIPHandlingPolicy(policy: string): void {
    this.rtcPolicy = policy;
  }

  // 触发子框架或主框架里的一次导航，回它有没有被拦
  frameNavigate(isMainFrame: boolean): boolean {
    let stopped = false;
    const fn = this.listeners.get('will-frame-navigate');
    assert.ok(fn, 'will-frame-navigate');
    fn({ preventDefault: () => { stopped = true; }, isMainFrame });
    return stopped;
  }

  fire(event: string, ...args: unknown[]): boolean {
    let stopped = false;
    const fn = this.listeners.get(event) as ((e: Stop, ...args: unknown[]) => void) | undefined;
    assert.ok(fn, event);
    fn({ preventDefault: () => { stopped = true; } }, ...args);
    return stopped;
  }
}

test('页面限制：去别的地址被拦，重新加载当前地址放行；重定向、webview、新窗口、蓝牙设备都拒绝；子框架里的导航一律拦；WebRTC 不发 UDP 包', () => {
  const wc = new FakeContents();
  lockDown(wc);
  // 子框架(iframe)加载任何地址都拦；主框架的归 will-navigate 管，这里不拦
  assert.deepEqual([wc.frameNavigate(false), wc.frameNavigate(true)], [true, false]);
  assert.equal(wc.rtcPolicy, 'disable_non_proxied_udp');
  assert.equal(wc.fire('will-navigate', 'https://example.com/'), true);
  assert.equal(wc.fire('will-navigate', 'fox://host/window/index.html'), true);
  assert.equal(wc.fire('will-navigate', 'fox://yanuo.shell-classic.panel/panel.html#x'), true);
  assert.equal(wc.fire('will-navigate', 'fox://yanuo.shell-classic.panel/panel.html'), false);
  // 页面里改了地址的 # 部分之后，重新加载的是带 # 的地址
  wc.url = 'fox://host/window/index.html#/logs';
  assert.equal(wc.fire('will-navigate', 'fox://host/window/index.html#/logs'), false);
  assert.equal(wc.fire('will-navigate', 'fox://host/window/index.html'), true);
  assert.equal(wc.fire('will-redirect', 'fox://host/window/index.html#/logs'), true);
  assert.equal(wc.fire('will-redirect', 'https://example.com/'), true);
  assert.equal(wc.fire('will-attach-webview'), true);
  const picked: string[] = [];
  assert.equal(wc.fire('select-bluetooth-device', [{ deviceId: 'd1' }], (id: string) => picked.push(id)), true);
  assert.deepEqual(picked, ['']);
  assert.deepEqual(wc.openHandler?.(), { action: 'deny' });
});

test('登记窗口：记下页面的类别、组件 id 和远程服务名，加上页面限制；窗口销毁后注销', () => {
  const s = new Senders();
  const win = new FakeContents(11);
  const kb = new FakeContents(12);
  const media = new FakeContents(13);
  adopt(s, win, 'window');
  adopt(s, kb, 'media', ['a.asr', 'a.tts'], ['keyboard']);
  adopt(s, media, 'media', ['a.asr']);
  assert.deepEqual(s.get(11), { kind: 'window' });
  assert.deepEqual([s.get(12)?.kind, ids(s.get(12)), remotes(s.get(12))], ['media', ['a.asr', 'a.tts'], ['keyboard']]);
  assert.deepEqual([s.get(13)?.kind, ids(s.get(13)), remotes(s.get(13))], ['media', ['a.asr'], []]);
  // 登记了的页面都有页面限制
  for (const wc of [win, kb, media]) {
    assert.deepEqual(wc.events, ['destroyed', 'select-bluetooth-device', 'will-attach-webview', 'will-frame-navigate', 'will-navigate', 'will-redirect']);
    assert.equal(wc.rtcPolicy, 'disable_non_proxied_udp');
    assert.equal(wc.fire('will-navigate', 'https://example.com/'), true);
    assert.deepEqual(wc.openHandler?.(), { action: 'deny' });
  }
  // 销毁的那个注销，别的还在；同一个 id 之后登记的不受影响
  kb.fire('destroyed');
  assert.deepEqual([s.get(11)?.kind, s.get(12), s.get(13)?.kind], ['window', undefined, 'media']);
  adopt(s, new FakeContents(12), 'window');
  assert.deepEqual(s.get(12), { kind: 'window' });
});

type Asker = { id: number } | null;

const missing = (): never => {
  throw new Error('处理函数没装上');
};

// 假的会话：记下三个权限处理函数和 will-download 的监听(没装上的调用时抛出)
class FakeSession {
  request: (wc: Asker, permission: string, done: (granted: boolean) => void) => void = missing;
  check: (wc: Asker, permission: string) => boolean = missing;
  device: () => boolean = missing;
  download: (e: Stop) => void = missing;

  setPermissionRequestHandler(fn: (wc: Asker, permission: string, done: (granted: boolean) => void) => void): void {
    this.request = fn;
  }

  setPermissionCheckHandler(fn: (wc: Asker, permission: string) => boolean): void {
    this.check = fn;
  }

  setDevicePermissionHandler(fn: () => boolean): void {
    this.device = fn;
  }

  on(event: string, fn: (e: Stop) => void): void {
    assert.equal(event, 'will-download');
    this.download = fn;
  }
}

test('会话的限制：权限按发起的窗口是哪种页面给，设备一律不给，下载一律取消', () => {
  const s = new Senders();
  s.add(1, 'window');
  s.add(2, 'media', ['a.asr']);
  s.addPanel(3, 'a.shell', ['a.shell'], []);
  const ses = new FakeSession();
  limitPermissions(ses, s);
  const { request, check, device, download } = ses;
  // 主窗口、媒体页面、面板页面、没登记的窗口、不是窗口发起的
  const askers: Asker[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 9 }, null];
  const requested = (permission: string): boolean[] => askers.map(wc => {
    const answers: boolean[] = [];
    request(wc, permission, granted => answers.push(granted));
    assert.equal(answers.length, 1);
    return answers[0] === true;
  });
  assert.deepEqual(requested('media'), [false, true, false, false, false]);
  assert.deepEqual(askers.map(wc => check(wc, 'media')), [true, true, false, false, false]);
  for (const p of ['clipboard-read', 'clipboard-sanitized-write', 'hid', 'serial', 'usb', 'notifications', 'display-capture']) {
    assert.deepEqual(requested(p), [false, false, false, false, false], p);
    assert.deepEqual(askers.map(wc => check(wc, p)), [false, false, false, false, false], p);
  }
  assert.equal(device(), false);
  // 窗口注销后它的 media 也不给
  s.remove(2);
  assert.deepEqual([requested('media')[1], check({ id: 2 }, 'media')], [false, false]);
  let stopped = 0;
  download({ preventDefault: () => { stopped++; } });
  assert.equal(stopped, 1);
});

// ---- 面板页面 ----

const panelOf = (info: SenderInfo | undefined): string | null => (info?.kind === 'panel' ? info.panel : null);

test('面板页面：登记时带面板 id、这一页加载的组件 id 和够得着的远程服务；各块面板各有各的，互不相干', () => {
  const s = new Senders();
  s.add(1, 'window');
  s.add(2, 'media', ['a.asr'], ['keyboard']);
  s.addPanel(10, 'a.kb', ['a.kb', 'a.side', 'a.ime'], ['keyboard', 'panels']);
  s.addPanel(11, 'a.clock', ['a.clock'], []);
  assert.deepEqual([s.get(10)?.kind, panelOf(s.get(10)), ids(s.get(10)), remotes(s.get(10))], ['panel', 'a.kb', ['a.kb', 'a.side', 'a.ime'], ['keyboard', 'panels']]);
  assert.deepEqual([s.get(11)?.kind, panelOf(s.get(11)), ids(s.get(11)), remotes(s.get(11))], ['panel', 'a.clock', ['a.clock'], []]);
  assert.deepEqual([panelOf(s.get(1)), panelOf(s.get(2)), panelOf(s.get(99))], [null, null, null]);
  const kb = s.get(10);
  const clock = s.get(11);
  assert.ok(kb && clock);
  // 组件 id：只能用自己这一页的
  assert.deepEqual([ownsComponent(kb, 'a.kb'), ownsComponent(kb, 'a.side'), ownsComponent(kb, 'a.clock'), ownsComponent(clock, 'a.clock'), ownsComponent(clock, 'a.kb'), ownsComponent(clock, 5)], [true, true, false, true, false, false]);
  // 总线频道：以自己这一页某个组件的 id 加「/」开头；核心的频道发不了
  assert.deepEqual(
    [ownsChannel(kb, 'a.side/x'), ownsChannel(kb, 'a.ime/langs'), ownsChannel(kb, 'a.clock/tick'), ownsChannel(clock, 'a.clock/tick'), ownsChannel(clock, 'core/component-removed'), ownsChannel(clock, 'a.clock')],
    [true, true, false, true, false, false],
  );
  // 远程服务：只有计划里写了的
  assert.deepEqual([usesRemote(kb, 'keyboard'), usesRemote(kb, 'panels'), usesRemote(kb, 'usage'), usesRemote(clock, 'keyboard'), usesRemote(clock, 'panels')], [true, true, false, false, false]);
});

test('面板页面：计划变了重新登记这一页，别的面板和媒体页面加载列表的更新都不动它；窗口没了注销', () => {
  const s = new Senders();
  s.add(2, 'media', ['a.asr'], ['keyboard']);
  s.addPanel(10, 'a.kb', ['a.kb'], ['keyboard']);
  s.addPanel(11, 'a.clock', ['a.clock'], []);
  s.addPanel(10, 'a.kb', ['a.kb', 'a.side'], []);
  assert.deepEqual([ids(s.get(10)), remotes(s.get(10)), ids(s.get(11))], [['a.kb', 'a.side'], [], ['a.clock']]);
  s.loadMedia([], []);
  assert.deepEqual([ids(s.get(10)), ids(s.get(11)), panelOf(s.get(10))], [['a.kb', 'a.side'], ['a.clock'], 'a.kb']);
  assert.deepEqual(ids(s.get(2)), []);
  s.remove(10);
  assert.deepEqual([s.get(10), panelOf(s.get(11))], [undefined, 'a.clock']);
});

test('面板页面：什么权限都申请不到、查不到', () => {
  const panel: SenderInfo = { kind: 'panel', panel: 'a.clock', ids: new Set(['a.clock']), remotes: new Set() };
  for (const p of ['media', 'clipboard-read', 'clipboard-sanitized-write', 'hid', 'serial', 'usb', 'notifications', 'display-capture', 'fullscreen', 'pointerLock']) {
    assert.deepEqual([mayRequest(panel, p), mayCheck(panel, p)], [false, false], p);
  }
  const s = new Senders();
  s.addPanel(10, 'a.clock', ['a.clock'], []);
  const ses = new FakeSession();
  limitPermissions(ses, s);
  const answers: boolean[] = [];
  ses.request({ id: 10 }, 'media', granted => answers.push(granted));
  assert.deepEqual([answers, ses.check({ id: 10 }, 'media'), ses.device()], [[false], false, false]);
});
