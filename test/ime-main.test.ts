import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppInfo, Caller, KeyboardCalls, KeyboardState, MainContext, Manifest, OutputPayload, Served } from '@konkon-lab/foxpanel-sdk';
import { GET, LANGS, MODE, parseLangsInfo, SOGOU, SOGOU_DONE, type LangsInfo } from '../components/ime/src/channels.ts';
import ime from '../components/ime/src/main.ts';
import { parseManifest } from '../src/shared/manifest.ts';

// 一个装着的语言组件
interface Lang {
  dir: string;
  manifest: Manifest;
}

// 输入法组件用到的那部分宿主
type HostContext = Pick<MainContext, 'appDir' | 'dataDir' | 'log' | 'storage' | 'bus' | 'app'> & {
  relay: Pick<MainContext['relay'], 'serve'>;
  output: Pick<MainContext['output'], 'send' | 'typing' | 'clear'>;
  input: Pick<MainContext['input'], 'dictate'>;
  translator: Pick<MainContext['translator'], 'translate'>;
  effect(fn: () => () => void): void;
};

// 调用者：主进程组件、键盘面板的页面
const from = (component: string): Caller => ({ component, where: 'process' });
const PAGE: Caller = { component: 'yanuo.shell-classic', where: 'panel' };

// 让排着的操作都做完：这里的操作只靠 promise 接力，不等文件和定时器
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

// 清单按最少的字段校验出来
function manifestOf(raw: Record<string, unknown>): Manifest {
  const r = parseManifest({ version: '1.0.0', author: 'test', license: 'MIT', ...raw });
  if (!r.ok) assert.fail(`${String(raw['id'])}：${r.errors.join('；')}`);
  return r.manifest;
}

// 应用信息里一个不是语言的组件
function other(id: string, kind: 'output' | 'window', on = true): AppInfo['components'][number] {
  const manifest = manifestOf({ id, kind, name: id, ...(kind === 'output' ? { main: 'main.js' } : { page: 'page.js' }) });
  return { id, kind, name: manifest.name, dir: `/components/${id}`, manifest, on, active: on };
}

// 假的宿主：程序目录里只有三个空的内置方案、没有 rime.dll；数据、总线、应用信息都记在内存里
class Host {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-ime-main-'));
  readonly store = new Map<string, unknown>();
  readonly logs: string[] = [];
  readonly sent: { channel: string; data: unknown }[] = [];   // 组件发到总线上的
  readonly states: KeyboardState[] = [];      // 经远程服务 keyboard 发布的状态
  readonly servedNames: string[] = [];        // 组件登记成提供方的远程服务名
  readonly done: string[] = [];               // 组件经宿主的通用接口做的事
  appInfo: AppInfo = { locale: 'zh-Hans', components: [], outputs: [], inputs: [], canDictate: false };   // 组件读到的应用信息
  clipboard: () => Promise<string> = () => Promise.resolve('');
  private calls: Served<KeyboardCalls> | null = null;
  private readonly watchers = new Set<(info: AppInfo) => void>();
  private readonly handlers = new Map<string, ((data: unknown) => void)[]>();
  private readonly disposers: (() => void)[] = [];

  constructor(t: TestContext) {
    const shared = path.join(this.root, 'app', 'vendor', 'rime', 'data');
    fs.mkdirSync(shared, { recursive: true });
    for (const s of ['clover', 'easy_en', 'jaroomaji']) fs.writeFileSync(path.join(shared, `${s}.schema.yaml`), '');
    t.after(() => {
      for (const dispose of this.disposers) dispose();
      fs.rmSync(this.root, { recursive: true, force: true });
    });
  }

  // 启动组件
  async start(): Promise<void> {
    const current = (): AppInfo => this.appInfo;
    const ctx: HostContext = {
      appDir: path.join(this.root, 'app'),
      dataDir: path.join(this.root, 'data'),
      log: text => { this.logs.push(text); },
      storage: {
        get: <T>(key: string) => Promise.resolve((this.store.get(key) ?? null) as T | null),
        set: (key, value) => {
          this.store.set(key, value);
          return Promise.resolve();
        },
        delete: key => {
          this.store.delete(key);
          return Promise.resolve();
        },
      },
      bus: {
        send: (channel, data) => { this.sent.push({ channel, data }); },
        on: (channel, fn) => {
          this.handlers.set(channel, [...this.handlers.get(channel) ?? [], fn]);
          return () => undefined;
        },
      },
      relay: {
        // 被测的组件只提供 keyboard：实现和状态按它的约定收
        serve: (name, impl) => {
          this.servedNames.push(name);
          this.calls = impl as Served<KeyboardCalls>;
          return { active: true, watch: () => () => undefined, publish: s => { this.states.push(s as KeyboardState); }, close: () => undefined };
        },
      },
      app: {
        get info() { return current(); },
        watch: fn => {
          this.watchers.add(fn);
          return () => { this.watchers.delete(fn); };
        },
        setOn: (id, on) => { this.done.push(`setOn ${id} ${on}`); },
        clipboard: { read: () => this.clipboard(), write: text => { this.done.push(`copy ${text}`); } },
      },
      output: {
        send: (p: OutputPayload, live) => {
          this.done.push(`send ${p.text}|${p.spoken}|${p.notify}|${live}`);
          return Promise.resolve([]);
        },
        typing: on => { this.done.push(`typing ${on}`); },
        clear: () => { this.done.push('clear'); },
      },
      input: { dictate: on => { this.done.push(`dictate ${on}`); } },
      translator: {
        translate: text => {
          this.done.push(`translate ${text}`);
          return Promise.resolve(`<${text}>`);
        },
      },
      effect: fn => { this.disposers.push(fn()); },
    };
    await ime.apply(ctx as unknown as MainContext);
  }

  // 一个语言组件：files = 它 rime/ 里的文件
  lang(id: string, imeField: object, files: Record<string, string> = {}): Lang {
    const dir = path.join(this.root, 'langs', id);
    fs.mkdirSync(path.join(dir, 'rime'), { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'rime', name), text);
    return { dir, manifest: manifestOf({ id, kind: 'lang', name: id, ime: imeField }) };
  }

  // 一份应用信息：installed = 已装的语言(按组件顺序)，active = 其中开着的(默认全开)；more 里的 components 是别的组件，排在语言后面
  make(installed: Lang[], active = installed.map(l => l.manifest.id), more: Partial<AppInfo> = {}): AppInfo {
    const row = (l: Lang): AppInfo['components'][number] => {
      const on = active.includes(l.manifest.id);
      return { id: l.manifest.id, kind: 'lang', name: l.manifest.name, dir: l.dir, manifest: l.manifest, on, active: on };
    };
    return { locale: 'zh-Hans', outputs: [], inputs: [], canDictate: false, ...more, components: [...installed.map(row), ...more.components ?? []] };
  }

  // 应用信息变了：换成新的一份并通知组件
  async info(installed: Lang[], active?: string[], more: Partial<AppInfo> = {}): Promise<void> {
    this.appInfo = this.make(installed, active, more);
    for (const fn of [...this.watchers]) fn(this.appInfo);
    await settle();
  }

  // 组件给远程服务 keyboard 登记的实现
  remote(): Served<KeyboardCalls> {
    return this.calls ?? assert.fail('组件没有登记远程服务 keyboard');
  }

  // 键盘面板的页面发一个操作
  act(a: unknown): unknown {
    return this.remote().act(PAGE, a);
  }

  // 往总线的一个频道发数据(主窗口部分发来的)
  async emit(channel: string, data?: unknown): Promise<void> {
    for (const fn of this.handlers.get(channel) ?? []) fn(data);
    await settle();
  }

  // 组件发过的语言信息
  get langsSent(): LangsInfo[] {
    return this.sent.filter(m => m.channel === LANGS).map(m => parseLangsInfo(m.data) ?? assert.fail('语言信息格式不对'));
  }

  get last(): KeyboardState {
    return this.states.at(-1) ?? assert.fail('没有发布过状态');
  }

  // rime 用户目录里的文件名
  get userFiles(): string[] {
    return fs.readdirSync(path.join(this.root, 'data', 'rime', 'data')).sort();
  }

  get schemaList(): string {
    return fs.readFileSync(path.join(this.root, 'data', 'rime', 'data', 'default.custom.yaml'), 'utf8');
  }
}

const schemaList = (...ids: string[]): string => `patch:\n  schema_list:\n${ids.map(id => `    - schema: ${id}\n`).join('')}`;

// 四种语言，加一种自带方案文件的
function langs(h: Host): Record<'zh' | 'en' | 'ja' | 'ko' | 'own', Lang> {
  return {
    zh: h.lang('test.zh', { schema: 'clover', modes: [{ id: 'simplified', label: '简体' }, { id: 'traditional', label: '繁体' }] }),
    en: h.lang('test.en', { schema: 'easy_en', latin: true, modes: [{ id: 'word', label: 'Words' }, { id: 'letter', label: 'Letters', direct: true }] }),
    ja: h.lang('test.ja', { schema: 'jaroomaji', enter: 'rime', modes: [{ id: 'kanji', label: '漢字' }, { id: 'hiragana', label: 'ひらがな', output: 'composition' }] }),
    ko: h.lang('test.ko', { engine: 'hangul' }),
    own: h.lang('test.own', { schema: 'own' }, { 'own.schema.yaml': 'schema:\n', 'own.dict.yaml': 'words\n' }),
  };
}

test('输入法组件：没有 rime.dll 时记一条错误，内置方案的补丁照样写进用户目录；没装语言时发布一份没就绪的状态', async t => {
  const h = new Host(t);
  await h.start();
  await settle();
  assert.ok(h.logs.includes('missing vendor/rime, run npm run vendor:rime'));
  assert.deepEqual(h.userFiles, ['clover.custom.yaml', 'default.custom.yaml', 'easy_en.custom.yaml', 'jaroomaji.custom.yaml']);
  assert.equal(h.schemaList, schemaList());
  assert.deepEqual(h.servedNames, ['keyboard']);
  assert.deepEqual([h.states.length, h.last.ready, h.last.packs, h.last.uiLang], [1, false, [], 'zh-Hans']);
  assert.deepEqual(h.langsSent, [{ langs: [], modes: {}, sogouWords: 0 }]);
});

test('输入法组件：启动时就按当时的应用信息定语言、界面语言、输出和听写，不等它变', async t => {
  const h = new Host(t);
  const l = langs(h);
  h.appInfo = h.make([l.zh, l.en], ['test.en'], { locale: 'ko', canDictate: true, outputs: [{ id: 'a.out', name: 'Out', on: false, live: true, typing: true }] });
  await h.start();
  await settle();
  assert.deepEqual(h.last.packs.map(p => p.id), ['test.en']);
  assert.deepEqual([h.last.lang, h.last.uiLang, h.last.canDictate], ['test.en', 'ko', true]);
  assert.deepEqual(h.last.outputs, [{ id: 'a.out', name: 'Out', on: false }]);
  assert.equal(h.schemaList, schemaList('clover', 'easy_en'));
  assert.deepEqual(h.langsSent.map(x => x.langs.map(p => p.id)), [['test.zh', 'test.en']]);
});

test('输入法组件：已装的语言同步进用户目录并通知主窗口；开关只换键盘上的语言列表，顺序跟组件顺序', async t => {
  const h = new Host(t);
  const l = langs(h);
  await h.start();
  const told0 = h.langsSent.length;

  await h.info([l.zh, l.en, l.ja, l.ko, l.own], undefined, { locale: 'ja', canDictate: true, outputs: [{ id: 'a.out', name: 'Out', on: true, live: true, typing: false }] });
  assert.deepEqual(h.last.packs.map(p => p.id), ['test.zh', 'test.en', 'test.ja', 'test.ko', 'test.own']);
  assert.equal(h.last.lang, 'test.zh');
  assert.equal(h.last.ready, false);
  assert.equal(h.last.uiLang, 'ja');
  assert.equal(h.last.canDictate, true);
  assert.deepEqual(h.last.outputs, [{ id: 'a.out', name: 'Out', on: true }]);
  assert.equal(h.schemaList, schemaList('clover', 'easy_en', 'jaroomaji', 'own'));
  assert.deepEqual(h.userFiles, ['clover.custom.yaml', 'default.custom.yaml', 'easy_en.custom.yaml', 'jaroomaji.custom.yaml', 'own.dict.yaml', 'own.schema.yaml']);
  assert.deepEqual(h.langsSent.slice(told0), [{
    langs: [
      { id: 'test.zh', pinyin: true, modes: [{ id: 'simplified', label: '简体' }, { id: 'traditional', label: '繁体' }] },
      { id: 'test.en', pinyin: false, modes: [{ id: 'word', label: 'Words' }, { id: 'letter', label: 'Letters' }] },
      { id: 'test.ja', pinyin: false, modes: [{ id: 'kanji', label: '漢字' }, { id: 'hiragana', label: 'ひらがな' }] },
      { id: 'test.ko', pinyin: false, modes: [{ id: 'default', label: 'test.ko' }] },
      { id: 'test.own', pinyin: false, modes: [{ id: 'default', label: 'test.own' }] },
    ],
    modes: {},
    sogouWords: 0,
  }]);

  // 界面语言、输出、听写变了，语言没变：发布新状态，不重新通知主窗口
  const pushed = h.states.length;
  await h.info([l.zh, l.en, l.ja, l.ko, l.own]);
  assert.ok(h.states.length > pushed);
  assert.deepEqual([h.last.uiLang, h.last.canDictate, h.last.outputs], ['zh-Hans', false, []]);
  assert.equal(h.langsSent.length, told0 + 1);

  // 只改开着的：列表跟着变，设置里的语言还开着就留在它上面，关掉了用第一个开着的；不重新通知主窗口
  await h.act({ kind: 'lang', lang: 'test.zh' });
  const told = h.langsSent.length;
  await h.info([l.zh, l.en, l.ja, l.ko, l.own], ['test.ko', 'test.zh']);
  assert.deepEqual(h.last.packs.map(p => p.id), ['test.zh', 'test.ko']);
  assert.equal(h.last.lang, 'test.zh');
  await h.info([l.zh, l.en, l.ja, l.ko, l.own], ['test.ko', 'test.en']);
  assert.deepEqual(h.last.packs.map(p => p.id), ['test.en', 'test.ko']);
  assert.equal(h.last.lang, 'test.en');
  assert.equal(h.langsSent.length, told);
  assert.equal(h.schemaList, schemaList('clover', 'easy_en', 'jaroomaji', 'own'));
  // 组件顺序换了：键盘上的语言列表跟着换
  await h.info([l.ko, l.own, l.zh, l.en, l.ja], ['test.ko', 'test.en']);
  assert.deepEqual(h.last.packs.map(p => p.id), ['test.ko', 'test.en']);
  await h.info([l.zh, l.en, l.ja, l.ko, l.own], ['test.ko', 'test.en']);
  const retold = h.langsSent.length;

  // 卸掉两种语言：方案表里没有它们的方案，自带的文件删掉，重新通知主窗口
  await h.info([l.zh, l.en, l.ko]);
  assert.deepEqual(h.last.packs.map(p => p.id), ['test.zh', 'test.en', 'test.ko']);
  assert.equal(h.schemaList, schemaList('clover', 'easy_en'));
  assert.deepEqual(h.userFiles, ['clover.custom.yaml', 'default.custom.yaml', 'easy_en.custom.yaml', 'jaroomaji.custom.yaml']);
  assert.equal(h.langsSent.length, retold + 1);
  assert.deepEqual(h.langsSent.at(-1)?.langs.map(x => x.id), ['test.zh', 'test.en', 'test.ko']);
});

test('输入法组件：应用信息里和键盘无关的变化(别的组件装卸、开关，接了听写的是哪个输入源)不发布新状态', async t => {
  const h = new Host(t);
  const l = langs(h);
  await h.start();
  await h.info([l.zh, l.en], undefined, { canDictate: true, inputs: ['a.asr'] });
  const pushed = h.states.length;
  const told = h.langsSent.length;
  // 同样的内容再来一份
  await h.info([l.zh, l.en], undefined, { canDictate: true, inputs: ['a.asr'] });
  // 多了一个主窗口页面组件，再把它关掉；换了一个输入源
  await h.info([l.zh, l.en], undefined, { canDictate: true, inputs: ['a.asr'], components: [other('a.win', 'window')] });
  await h.info([l.zh, l.en], undefined, { canDictate: true, inputs: ['a.asr'], components: [other('a.win', 'window', false)] });
  await h.info([l.zh, l.en], undefined, { canDictate: true, inputs: ['b.asr'] });
  assert.deepEqual([h.states.length, h.langsSent.length], [pushed, told]);
  // 输出组件的开关变了：发布
  await h.info([l.zh, l.en], undefined, { canDictate: true, inputs: ['b.asr'], outputs: [{ id: 'a.out', name: 'Out', on: false, live: false, typing: false }] });
  assert.ok(h.states.length > pushed);
  assert.deepEqual(h.last.outputs, [{ id: 'a.out', name: 'Out', on: false }]);
});

test('输入法组件：方案文件不在的语言跳过并记日志', async t => {
  const h = new Host(t);
  const l = langs(h);
  const broken = h.lang('test.broken', { schema: 'nowhere' });
  await h.start();
  await h.info([l.zh, broken]);
  assert.deepEqual(h.last.packs.map(p => p.id), ['test.zh']);
  assert.deepEqual(h.langsSent.at(-1)?.langs.map(x => x.id), ['test.zh']);
  assert.equal(h.schemaList, schemaList('clover'));
  assert.ok(h.logs.includes('test.broken skipped: 没有 nowhere.schema.yaml'));
});

test('输入法组件：读存下来的设置和搜狗词条数；主窗口要语言信息、改模式、导入搜狗词库', async t => {
  const h = new Host(t);
  const l = langs(h);
  h.store.set('settings', { lang: 'test.ja', modes: { 'test.en': 'letter' }, autoSend: true, showTyping: 'no' });
  h.store.set('sogouWords', 12);
  h.appInfo = h.make([l.zh, l.en, l.ja]);
  await h.start();
  await settle();
  assert.equal(h.last.lang, 'test.ja');
  assert.deepEqual([h.last.settings.autoSend, h.last.settings.showTyping], [true, true]);
  assert.deepEqual(h.langsSent.map(x => [x.modes, x.sogouWords]), [[{ 'test.en': 'letter' }, 12]]);

  await h.emit(GET);
  assert.equal(h.langsSent.length, 2);
  assert.deepEqual(h.langsSent[1], h.langsSent[0]);

  await h.emit(MODE, { id: 'test.ja', mode: 'hiragana' });
  assert.equal(h.last.mode.id, 'hiragana');
  assert.deepEqual(h.last.settings.modes, { 'test.en': 'letter', 'test.ja': 'hiragana' });
  assert.deepEqual(h.store.get('settings'), h.last.settings);
  assert.deepEqual(h.langsSent.at(-1)?.modes, { 'test.en': 'letter', 'test.ja': 'hiragana' });

  // 格式不对的不处理
  const told = h.sent.length;
  await h.emit(MODE, { id: 'test.ja' });
  await h.emit(MODE, { id: 1, mode: 'kanji' });
  await h.emit(MODE, 'kanji');
  assert.equal(h.sent.length, told);
  assert.equal(h.last.mode.id, 'hiragana');

  await h.emit(SOGOU);
  assert.deepEqual(h.sent.at(-1), { channel: SOGOU_DONE, data: { ok: false, error: '输入法尚未就绪' } });
});

test('输入法组件：前面的操作没做完时连改两种语言的模式，两个都存下', async t => {
  const h = new Host(t);
  const l = langs(h);
  await h.start();
  await h.info([l.zh, l.en, l.ja]);
  let paste = (_text: string): void => undefined;
  h.clipboard = () => new Promise(resolve => { paste = resolve; });
  const pasted = h.act({ kind: 'paste' });
  await settle();
  await h.emit(MODE, { id: 'test.zh', mode: 'traditional' });
  await h.emit(MODE, { id: 'test.ja', mode: 'hiragana' });
  assert.deepEqual(h.last.settings.modes, {});
  paste('x');
  await pasted;
  await settle();
  assert.equal(h.last.text, 'x');
  assert.equal(h.last.mode.id, 'traditional');
  assert.deepEqual(h.last.settings.modes, { 'test.zh': 'traditional', 'test.ja': 'hiragana' });
  assert.deepEqual(h.store.get('settings'), h.last.settings);
  assert.deepEqual(h.langsSent.at(-1)?.modes, { 'test.zh': 'traditional', 'test.ja': 'hiragana' });
});

test('输入法组件：登记成远程服务 keyboard 的提供方，每次的状态经它发布', async t => {
  const h = new Host(t);
  const l = langs(h);
  await h.start();
  assert.deepEqual(h.servedNames, ['keyboard']);
  await h.info([l.zh, l.en], undefined, { locale: 'en' });
  const pushed = h.states.length;
  await h.act({ kind: 'text', text: 'a' });
  assert.equal(h.states.length, pushed + 1);
  assert.equal(h.last.text, 'a');
  assert.equal(h.last.uiLang, 'en');
});

test('输入法组件：发送、「正在输入」、清除、翻译、开关听写、开关输出、剪贴板走宿主的通用接口', async t => {
  const h = new Host(t);
  const l = langs(h);
  await h.start();
  await h.info([l.en], undefined, {
    canDictate: true, inputs: ['a.asr'], components: [other('a.out', 'output'), other('a.win', 'window')],
    outputs: [{ id: 'a.out', name: 'Out', on: true, live: true, typing: true }],
  });
  await h.act({ kind: 'lang', lang: 'test.en', mode: 'letter' });
  h.done.length = 0;

  // 打字：让输出显示「正在输入」；发送：译文由翻译给，发给开着的输出
  await h.act({ kind: 'key', code: 'KeyH', shift: false });
  await h.act({ kind: 'send' });
  await settle();
  assert.deepEqual(h.done, ['typing true', 'translate h', 'send h|<h>|true|false']);
  assert.equal(h.last.text, '');

  h.done.length = 0;
  await h.act({ kind: 'clearOutputs' });
  await h.act({ kind: 'dictate' });
  await h.act({ kind: 'dictate' });
  assert.deepEqual(h.done, ['clear', 'dictate true', 'dictate false']);

  // 开关输出：只对应用信息里装着的输出组件做，别的组件和没装的 id 不做
  h.done.length = 0;
  await h.act({ kind: 'output', id: 'a.out', on: false });
  await h.act({ kind: 'output', id: 'a.win', on: false });
  await h.act({ kind: 'output', id: 'test.en', on: false });
  await h.act({ kind: 'output', id: 'x.none', on: true });
  assert.deepEqual(h.done, ['setOn a.out false']);

  // 复制写进系统剪贴板，粘贴从它读
  h.done.length = 0;
  await h.act({ kind: 'text', text: 'hi' });
  await h.act({ kind: 'copy' });
  h.clipboard = () => Promise.resolve(' there');
  await h.act({ kind: 'paste' });
  assert.deepEqual(h.done.filter(d => d.startsWith('copy')), ['copy hi']);
  assert.equal(h.last.text, 'hi there');
});

test('输入法组件：远程服务的 act 和 insert 收窄后交给键盘流程，格式不对的丢掉', async t => {
  const h = new Host(t);
  const l = langs(h);
  await h.start();
  await h.info([l.zh, l.ko], ['test.ko']);
  await h.act({ kind: 'key', code: 'KeyR', shift: false });
  assert.equal(h.last.composition, 'ㄱ');
  await h.remote().insert(from('a.other'), '1');
  assert.equal(h.last.text, 'ㄱ1');
  const pushed = h.states.length;
  assert.equal(h.act({ kind: 'key', code: 'F1', shift: false }), undefined);
  assert.equal(h.act('send'), undefined);
  assert.equal(h.remote().act(PAGE), undefined);
  assert.equal(h.remote().insert(PAGE, { text: 'x' }), undefined);
  assert.equal(h.remote().insert(PAGE), undefined);
  await settle();
  assert.equal(h.states.length, pushed);
});

test('输入法组件：远程服务的听写结果和听写结束只收接了听写的输入源发的', async t => {
  const h = new Host(t);
  const l = langs(h);
  await h.start();
  await h.info([l.en], undefined, { canDictate: true, inputs: ['a.asr'] });
  await h.act({ kind: 'lang', lang: 'test.en', mode: 'letter' });
  await h.act({ kind: 'dictate' });
  assert.equal(h.last.dictating, true);

  // 别的组件、键盘面板的页面、没带组件 id 的：都不收
  const pushed = h.states.length;
  h.remote().dictated(from('a.other'), 'no', true);
  h.remote().dictated(PAGE, 'no', true);
  h.remote().dictated({ component: 'a.asr', where: 'media' }, 'no', true);
  h.remote().dictationEnded(from('a.other'));
  h.remote().dictationEnded(PAGE);
  await settle();
  assert.equal(h.states.length, pushed);
  assert.equal(h.last.dictating, true);

  // 输入源发的：没说完的只显示，说完的插入；文字不是字符串的丢掉，final 不是 true 的按没说完算
  h.remote().dictated(from('a.asr'), 'hel', false);
  await settle();
  assert.deepEqual([h.last.dictation, h.last.text], ['hel', '']);
  h.remote().dictated(from('a.asr'), 'hello', 'yes');
  await settle();
  assert.deepEqual([h.last.dictation, h.last.text], ['hello', '']);
  const before = h.states.length;
  h.remote().dictated(from('a.asr'), 5, true);
  await settle();
  assert.equal(h.states.length, before);
  h.remote().dictated(from('a.asr'), 'hello', true);
  await settle();
  assert.deepEqual([h.last.dictation, h.last.text], ['', 'hello']);

  // 输入源不在名单里了：它发的听写结束不收；回到名单后收
  await h.info([l.en], undefined, { canDictate: true, inputs: ['b.asr'] });
  h.remote().dictationEnded(from('a.asr'));
  await settle();
  assert.equal(h.last.dictating, true);
  await h.info([l.en], undefined, { canDictate: true, inputs: ['a.asr'] });
  h.remote().dictationEnded(from('a.asr'));
  await settle();
  assert.equal(h.last.dictating, false);
});
