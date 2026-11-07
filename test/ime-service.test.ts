import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ImePack, KeyboardSettings, KeyboardState, KeyCode, OutputPayload } from '@konkon-lab/foxpanel-sdk';
import type { ImePort } from '../components/ime/src/client.ts';
import { parseIme } from '../components/ime/src/imepack.ts';
import { KeyboardService } from '../components/ime/src/keyboard.ts';
import type { ImeRequest, ImeResult } from '../components/ime/src/protocol.ts';
import { DEFAULT_KEYBOARD, normalizeKeyboard } from '../components/ime/src/settings.ts';

// 假的 rime：字母进输入串；候选是 [输入串]、[输入串]2、一个 emoji；空格上屏第一个候选；
// 逗号和输入中的符号由它处理(上屏全角逗号)，别的符号不处理
class FakeIme implements ImePort {
  input = '';
  schema: string | null = null;
  switches: Record<string, boolean> = {};
  delayMs = 0;                 // 每个请求晚多久回(毫秒)
  failing = new Set<string>(); // 这些 kind 的请求报错
  readonly kinds: string[] = [];
  stopped = false;
  private readonly held = new Map<string, Promise<void>>();

  // 按住某种请求不回，调返回的函数才放行
  hold(kind: string): () => void {
    let open = (): void => undefined;
    this.held.set(kind, new Promise(resolve => { open = resolve; }));
    return () => {
      this.held.delete(kind);
      open();
    };
  }

  private state(commit: string | null = null): ImeResult {
    const candidates = this.input ? [`[${this.input}]`, `[${this.input}]2`, '😀'].map((text, index) => ({ index, text })) : [];
    return { commit, composition: this.input, compositionCaret: this.input.length, candidates };
  }

  private take(text: string): ImeResult {
    this.input = '';
    return this.state(text);
  }

  private handle(req: Exclude<ImeRequest, { kind: 'importDict' }>): ImeResult {
    if (this.failing.has(req.kind)) throw new Error(`${req.kind} failed`);
    switch (req.kind) {
      case 'init':
        this.schema = req.schema;
        this.switches = req.switches;
        return this.state();
      case 'schema':
        if (req.id !== this.schema) this.input = '';
        this.schema = req.id;
        this.switches = req.switches;
        return this.state();
      case 'deploy':
      case 'clear':
        this.input = '';
        return this.state();
      case 'key':
        if (req.name === 'space') return this.input ? this.take(`[${this.input}]`) : this.state();
        if (req.name === 'Return') return this.take(this.input);
        if (req.name === 'BackSpace') this.input = this.input.slice(0, -1);
        else if (req.name.length === 1) this.input += req.name;
        return this.state();
      case 'char': {
        const handled = this.input !== '' || req.char === ',';
        return { ...(handled ? this.take(`${this.input ? `[${this.input}]` : ''}，`) : this.state()), handled };
      }
      case 'select': return this.take(`[${this.input}]${req.index ? req.index + 1 : ''}`);
      case 'raw': return this.take(this.input);
    }
  }

  async request(req: Exclude<ImeRequest, { kind: 'importDict' }>): Promise<ImeResult> {
    this.kinds.push(req.kind);
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    await this.held.get(req.kind);
    return this.handle(req);
  }

  importDict(): Promise<number> {
    return Promise.resolve(-1);
  }

  stop(): void {
    this.stopped = true;
  }
}

const pack = (id: string, ime: object): ImePack => ({ ...parseIme(ime, id), id, name: id });
const ZH = pack('zh', { schema: 'clover', modes: [{ id: 'simp', label: '简', switches: { s2t: false } }, { id: 'trad', label: '繁', switches: { s2t: true } }] });
const EN = pack('en', { schema: 'easy_en', latin: true, modes: [{ id: 'word', label: 'w' }, { id: 'letter', label: 'l', direct: true }] });
const JA = pack('ja', {
  schema: 'jaroomaji', enter: 'rime',
  modes: [{ id: 'kanji', label: '漢' }, { id: 'hiragana', label: 'あ', output: 'composition' }, { id: 'katakana', label: 'ア', output: 'katakana' }],
});
const KO = pack('ko', { engine: 'hangul', modes: [{ id: 'hangul', label: '한글' }, { id: 'hanja', label: '한자' }] });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-ime-'));
const hanjaFile = path.join(tmp, 'hanja.txt');
fs.writeFileSync(hanjaFile, '한:韓:\n한:漢:\n');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// 一个键盘服务：假的 rime，没有显示「正在输入」的输出，收实时内容的输出默认也没有
class Rig {
  readonly ime = new FakeIme();
  packs: ImePack[] = [ZH, EN, JA, KO];
  settings: KeyboardSettings;
  readonly sent: { payload: OutputPayload; live: boolean }[] = [];
  readonly logs: string[] = [];
  readonly clipboard = { text: '', delayMs: 0, broken: false };
  readonly dictation = { can: true, on: false };
  live = false;                // 有收实时内容的输出
  outputs: KeyboardState['outputs'] = [];   // 装着的输出组件
  readonly switched: [string, boolean][] = [];   // 开关过的组件
  cleared = 0;                 // 清除各输出显示内容的次数
  readonly kb: KeyboardService;
  readonly states: KeyboardState[] = [];   // 推出去的状态

  constructor(lang: string, modes: Record<string, string> = {}) {
    this.settings = normalizeKeyboard({ lang, modes });
    this.kb = new KeyboardService({
      settings: () => this.settings,
      save: patch => { this.settings = normalizeKeyboard(patch, this.settings); },
      sogouImported: () => undefined,
      output: (payload, live) => {
        this.sent.push({ payload, live });
        return Promise.resolve([]);
      },
      hasLive: () => this.live,
      hasTyping: () => false,
      typing: () => undefined,
      clearOutputs: () => { this.cleared++; },
      setOutput: (id, on) => { this.switched.push([id, on]); },
      outputs: () => this.outputs,
      translate: text => Promise.resolve(text),
      dictate: on => { this.dictation.on = on; },
      canDictate: () => this.dictation.can,
      clipboard: {
        read: async () => {
          if (this.clipboard.delayMs) await new Promise(resolve => setTimeout(resolve, this.clipboard.delayMs));
          if (this.clipboard.broken) throw new Error('clipboard broken');
          return this.clipboard.text;
        },
        write: text => { this.clipboard.text = text; },
      },
      broadcast: state => { this.states.push(state); },
      log: text => { this.logs.push(text); },
      ime: this.ime,
      rimePaths: { dll: '', shared: '', user: '', prebuilt: '', staging: tmp, log: '' },
      hanjaFile,
      packs: () => this.packs,
      uiLang: () => 'zh-Hans',
    });
  }

  // 最近一次推出去的状态
  get last(): KeyboardState {
    return this.states.at(-1) ?? assert.fail('没有推过状态');
  }

  key(code: KeyCode, shift = false): Promise<void> {
    return this.kb.act({ kind: 'key', code, shift });
  }

  // 依次按小写字母键
  async type(letters: string): Promise<void> {
    for (const c of letters) await this.key(`Key${c.toUpperCase()}` as KeyCode);
  }

  // 等排着的操作都做完(refresh、dictated 不返回 promise)
  settle(): Promise<void> {
    return this.kb.act({ kind: 'caret', position: Number.MAX_SAFE_INTEGER });
  }
}

// rime 已经启动好的
async function ready(lang: string, modes: Record<string, string> = {}): Promise<Rig> {
  const r = new Rig(lang, modes);
  await r.kb.start();
  return r;
}

const UNTIL_ROUNDS = 1000;   // until 最多让出事件循环这么多轮

// 等到条件成立(让出事件循环)；让出 UNTIL_ROUNDS 轮还不成立算失败
async function until(cond: () => boolean): Promise<void> {
  for (let round = 0; !cond(); round++) {
    assert.ok(round < UNTIL_ROUNDS, '条件一直不成立');
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('启动：按设置选方案和开关，就绪后推状态；DEFAULT 之外的语言照设置', async () => {
  const r = await ready('zh', { zh: 'trad' });
  assert.deepEqual(r.ime.kinds, ['init', 'schema']);
  assert.equal(r.ime.schema, 'clover');
  assert.deepEqual(r.ime.switches, { s2t: true });
  assert.equal(r.kb.engineState, 'ready');
  const s = r.last;
  assert.equal(s.ready, true);
  assert.equal(s.lang, 'zh');
  assert.equal(s.mode.id, 'trad');
  assert.deepEqual(s.packs.map(p => p.id), ['zh', 'en', 'ja', 'ko']);
  assert.ok(r.logs.includes('ime ready'));
  assert.notEqual(DEFAULT_KEYBOARD.lang, 'zh');
  r.kb.stop();
  assert.ok(r.ime.stopped);
});

test('启动：当前语言不用 rime 时不选方案', async () => {
  const r = await ready('ko');
  assert.deepEqual(r.ime.kinds, ['init']);
  assert.equal(r.ime.schema, null);
  assert.equal(r.last.ready, true);
  r.kb.stop();
});

test('拼音：字母进输入串，候选里没有 emoji；空格上屏第一个候选，数字选候选', async () => {
  const r = await ready('zh');
  await r.type('ni');
  assert.equal(r.last.composition, 'ni');
  assert.deepEqual(r.last.candidates, [{ index: 0, text: '[ni]' }, { index: 1, text: '[ni]2' }]);
  await r.key('Space');
  assert.equal(r.last.text, '[ni]');
  assert.equal(r.last.composition, '');
  await r.type('hao');
  await r.key('Digit2');
  assert.equal(r.last.text, '[ni][hao]2');
  // 没有那么多候选的数字不做事
  await r.type('a');
  await r.key('Digit9');
  assert.equal(r.last.composition, 'a');
  assert.equal(r.last.text, '[ni][hao]2');
  r.kb.stop();
});

test('拼音：不在输入中时数字、空格直接插入；大写字母在输入串上屏后插入', async () => {
  const r = await ready('zh');
  await r.key('Digit1');
  await r.key('Space');
  await r.key('Digit1', true);
  assert.equal(r.last.text, '1 !');
  await r.type('ni');
  await r.key('KeyA', true);
  assert.equal(r.last.text, '1 ![ni]A');
  assert.equal(r.last.composition, '');
  r.kb.stop();
});

test('拼音：符号交给 rime，rime 不处理的照原样插入', async () => {
  const r = await ready('zh');
  await r.key('Comma');
  await r.key('Slash');
  assert.equal(r.last.text, '，/');
  await r.type('ni');
  await r.key('Period');
  assert.equal(r.last.text, '，/[ni]，');
  r.kb.stop();
});

test('拼音：输入中的回车上屏字母，退格改输入串，方向键不动输入框', async () => {
  const r = await ready('zh');
  await r.type('nii');
  await r.key('Backspace');
  assert.equal(r.last.composition, 'ni');
  await r.key('ArrowLeft');
  assert.equal(r.last.caret, 0);
  await r.key('Enter');
  assert.equal(r.last.text, 'ni');
  assert.deepEqual(r.sent, []);
  r.kb.stop();
});

test('输入框：不在输入中时退格、方向键、回车(发送并清空)', async () => {
  const r = await ready('zh');
  await r.kb.act({ kind: 'text', text: 'abc' });
  await r.key('ArrowLeft');
  await r.key('Backspace');
  assert.equal(r.last.text, 'ac');
  assert.equal(r.last.caret, 1);
  await r.key('Home');
  await r.key('Delete');
  assert.equal(r.last.text, 'c');
  await r.key('Enter');
  await r.settle();
  assert.deepEqual(r.sent, [{ payload: { text: 'c', spoken: 'c', notify: true }, live: false }]);
  assert.equal(r.last.text, '');
  r.kb.stop();
});

test('发送：输入中的内容上屏后一起发；开着 PIN 时文字留在输入框', async () => {
  const r = await ready('zh');
  await r.type('ni');
  await r.kb.act({ kind: 'send' });
  await r.settle();
  assert.equal(r.sent[0]?.payload.text, '[ni]');
  assert.equal(r.last.text, '');
  await r.kb.act({ kind: 'settings', patch: { pinMessage: true } });
  await r.kb.act({ kind: 'text', text: 'x' });
  await r.kb.act({ kind: 'send' });
  await r.settle();
  assert.equal(r.sent[1]?.payload.text, 'x');
  assert.equal(r.last.text, 'x');
  r.kb.stop();
});

test('Tab 和 text：输入中的内容上屏后插入', async () => {
  const r = await ready('zh');
  await r.type('ni');
  await r.key('Tab');
  assert.equal(r.last.text, '[ni]    ');
  await r.type('a');
  await r.kb.act({ kind: 'text', text: '♪' });
  assert.equal(r.last.text, '[ni]    [a]♪');
  r.kb.stop();
});

test('假名模式：不出候选，回车和空格上屏输入串；片假名模式上屏片假名', async () => {
  const r = await ready('ja', { ja: 'hiragana' });
  r.ime.input = 'かな';
  await r.type('a');
  assert.equal(r.last.composition, 'かなa');
  assert.deepEqual(r.last.candidates, []);
  await r.key('Enter');
  assert.equal(r.last.text, 'かなa');
  r.ime.input = 'か';
  await r.type('a');
  await r.key('Digit1');
  assert.equal(r.last.text, 'かなaかa1');
  await r.kb.act({ kind: 'lang', lang: 'ja', mode: 'katakana' });
  assert.equal(r.settings.modes['ja'], 'katakana');
  r.ime.input = 'かな';
  await r.type('a');
  assert.equal(r.last.composition, 'カナa');
  await r.key('Space');
  assert.equal(r.last.text, 'かなaかa1カナa');
  r.kb.stop();
});

test('日语汉字模式：输入中的回车交给 rime', async () => {
  const r = await ready('ja');
  await r.type('ka');
  await r.key('Enter');
  assert.equal(r.last.text, 'ka');
  assert.equal(r.ime.kinds.at(-1), 'key');
  r.kb.stop();
});

test('拼音文字：字母(含大写)进输入串，空格、数字、符号在单词上屏后插入', async () => {
  const r = await ready('en');
  await r.key('KeyH', true);
  await r.type('i');
  assert.equal(r.last.composition, 'Hi');
  await r.key('Space');
  assert.equal(r.last.text, '[Hi] ');
  await r.type('a');
  await r.key('Digit1');
  await r.key('Comma');
  assert.equal(r.last.text, '[Hi] [a]1,');
  r.kb.stop();
});

test('直接打字母：不经过 rime', async () => {
  const r = await ready('en', { en: 'letter' });
  const before = r.ime.kinds.length;
  await r.type('ab');
  await r.key('KeyC', true);
  await r.key('Digit1', true);
  await r.key('Space');
  await r.key('Backspace');
  assert.equal(r.last.text, 'abC!');
  assert.equal(r.ime.kinds.length, before);
  r.kb.stop();
});

test('韩文：拼好的音节上屏，在拼的留在输入串；退格退字母，回车上屏；韩文汉字模式数字选汉字', async () => {
  const r = await ready('ko');
  await r.type('dkss');   // 안 + ㄴ
  assert.equal(r.last.text, '안');
  assert.equal(r.last.composition, 'ㄴ');
  await r.key('Backspace');
  assert.equal(r.last.composition, '');
  await r.type('s');
  await r.key('Enter');
  assert.equal(r.last.text, '안ㄴ');
  assert.deepEqual(r.sent, []);
  await r.key('Digit1');
  assert.equal(r.last.text, '안ㄴ1');
  await r.kb.act({ kind: 'clear' });

  await r.kb.act({ kind: 'lang', lang: 'ko', mode: 'hanja' });
  await r.type('gks');    // 한
  assert.equal(r.last.composition, '한');
  assert.deepEqual(r.last.candidates.map(c => c.text), ['韓', '漢']);
  await r.key('Digit2');
  assert.equal(r.last.text, '漢');
  assert.equal(r.last.composition, '');
  r.kb.stop();
});

test('排队：rime 回得慢时，后面的键等前面的结果', async () => {
  const r = await ready('zh');
  r.ime.delayMs = 5;
  const all = [r.key('KeyN'), r.key('KeyI'), r.key('Space'), r.key('Digit1'), r.key('KeyA'), r.key('Enter'), r.kb.act({ kind: 'text', text: '!' })];
  await Promise.all(all);
  assert.equal(r.last.text, '[ni]1a!');
  assert.equal(r.last.composition, '');
  r.kb.stop();
});

test('排队：粘贴等剪贴板时按的键排在粘贴后面；一个操作出错不卡住后面的', async () => {
  const r = await ready('zh');
  r.clipboard.text = 'a\r\nb';
  r.clipboard.delayMs = 5;
  const paste = r.kb.act({ kind: 'paste' });
  const key = r.key('Digit1');
  await Promise.all([paste, key]);
  assert.equal(r.last.text, 'a b1');

  r.clipboard.broken = true;
  const broken = r.kb.act({ kind: 'paste' });
  const after = r.key('Digit2');
  await assert.rejects(broken, /clipboard broken/);
  await after;
  assert.equal(r.last.text, 'a b12');
  r.kb.stop();
});

test('rime 没启动：直接打字母和韩文照常，用到 rime 的键不生效，ready 为 false', async () => {
  const r = new Rig('zh');
  assert.equal(r.kb.engineState, 'off');
  await r.type('ni');
  await r.key('Digit1');
  assert.equal(r.last.ready, false);
  assert.equal(r.last.text, '1');
  assert.deepEqual(r.ime.kinds, []);
  await r.kb.act({ kind: 'lang', lang: 'ko' });
  await r.type('dk');
  assert.equal(r.last.composition, '아');
  assert.equal(r.last.lang, 'ko');
  // 没启动时重新部署只定当前语言
  r.packs = [ZH];
  await r.kb.redeploy();
  assert.equal(r.last.lang, 'zh');
  assert.equal(r.last.composition, '');
  assert.deepEqual(r.ime.kinds, []);
  r.kb.stop();
});

test('初始化失败：一直不就绪，装卸语言不会让它变成就绪', async () => {
  const r = new Rig('zh');
  r.ime.failing.add('init');
  await r.kb.start();
  assert.equal(r.kb.engineState, 'failed');
  assert.equal(r.last.ready, false);
  assert.ok(r.logs.some(l => l.startsWith('ime init failed')));
  await r.kb.redeploy();
  assert.equal(r.kb.engineState, 'failed');
  assert.equal(r.last.ready, false);
  assert.deepEqual(r.ime.kinds, ['init']);
  r.kb.stop();
});

test('重新部署：丢弃没打完的输入，部署期间不就绪，完了重选方案；部署失败也回到就绪', async () => {
  const r = await ready('zh');
  await r.type('ni');
  const release = r.ime.hold('deploy');
  const done = r.kb.redeploy();
  await until(() => r.ime.kinds.at(-1) === 'deploy');
  assert.equal(r.kb.engineState, 'starting');
  assert.equal(r.last.ready, false);
  assert.equal(r.last.composition, '');
  // 部署期间按键照常处理，用到 rime 的不生效
  await r.type('a');
  await r.key('Digit1');
  assert.equal(r.last.text, '1');
  assert.equal(r.last.composition, '');
  release();
  await done;
  assert.equal(r.last.ready, true);
  assert.equal(r.last.text, '1');
  assert.deepEqual(r.ime.kinds.slice(-3), ['clear', 'deploy', 'schema']);

  r.ime.failing.add('deploy');
  await r.kb.redeploy();
  assert.equal(r.kb.engineState, 'ready');
  assert.ok(r.logs.some(l => l.startsWith('ime redeploy failed')));
  await r.type('a');
  assert.equal(r.last.composition, 'a');
  r.kb.stop();
});

test('启动：部署期间推一次没就绪的状态，语言包和设置已经有了；部署完变成就绪', async () => {
  const r = new Rig('ja', { ja: 'hiragana' });
  const release = r.ime.hold('init');
  const started = r.kb.start();
  await until(() => r.states.length > 0);
  assert.equal(r.kb.engineState, 'starting');
  assert.equal(r.states.length, 1);
  assert.deepEqual([r.last.ready, r.last.lang, r.last.pack.id, r.last.mode.id, r.last.packs.length], [false, 'ja', 'ja', 'hiragana', 4]);
  assert.deepEqual(r.ime.kinds, ['init']);
  release();
  await started;
  assert.deepEqual([r.last.ready, r.last.lang, r.last.mode.id], [true, 'ja', 'hiragana']);
  assert.deepEqual(r.ime.kinds, ['init', 'schema']);
  r.kb.stop();
});

test('启动时就要求重新部署：排在初始化后面', async () => {
  const r = new Rig('zh');
  r.ime.delayMs = 2;
  const started = r.kb.start();
  const redeployed = r.kb.redeploy();
  await Promise.all([started, redeployed]);
  assert.deepEqual(r.ime.kinds, ['init', 'schema', 'deploy', 'schema']);
  assert.equal(r.last.ready, true);
  r.kb.stop();
});

test('refresh：当前语言关掉了就用第一个开着的，没打完的输入丢弃', async () => {
  const r = await ready('zh');
  await r.type('ni');
  r.packs = [EN, KO];
  r.kb.refresh();
  await r.settle();
  assert.equal(r.last.lang, 'en');
  assert.equal(r.last.pack.id, 'en');
  assert.equal(r.last.composition, '');
  assert.equal(r.ime.schema, 'easy_en');
  // 设置里的语言没动：再开回来时回到它
  assert.equal(r.settings.lang, 'zh');
  r.packs = [EN, ZH];
  r.kb.refresh();
  await r.settle();
  assert.equal(r.last.lang, 'zh');
  r.kb.stop();
});

test('切换语言和模式：关着的语言不能切；同一语言换模式只设开关，不打断输入', async () => {
  const r = await ready('zh');
  r.packs = [ZH, EN];
  await r.kb.act({ kind: 'lang', lang: 'ko' });
  assert.equal(r.last.lang, 'zh');
  await r.type('ni');
  await r.kb.act({ kind: 'settings', patch: { modes: { zh: 'trad' } } });
  assert.deepEqual(r.ime.switches, { s2t: true });
  assert.equal(r.last.mode.id, 'trad');
  assert.equal(r.last.composition, 'ni');
  await r.kb.act({ kind: 'lang', lang: 'en', mode: 'letter' });
  assert.equal(r.last.lang, 'en');
  assert.equal(r.last.mode.id, 'letter');
  assert.equal(r.last.composition, '');
  assert.deepEqual(r.settings.modes, { zh: 'trad', en: 'letter' });
  r.kb.stop();
});

test('听写：开着时没说完的一句只显示，说完的插入；别处停了跟着结束；没有输入源时开不了', async () => {
  const r = await ready('zh');
  r.kb.dictated('忽略', true);
  await r.kb.act({ kind: 'dictate' });
  assert.equal(r.last.dictating, true);
  assert.equal(r.dictation.on, true);
  r.kb.dictated('你', false);
  await r.settle();
  assert.equal(r.last.dictation, '你');
  assert.equal(r.last.text, '');
  r.kb.dictated(' 你好 ', true);
  await r.settle();
  assert.equal(r.last.dictation, '');
  assert.equal(r.last.text, '你好');
  r.kb.dictationEnded();
  await r.settle();
  assert.equal(r.last.dictating, false);
  r.dictation.can = false;
  await r.kb.act({ kind: 'dictate' });
  assert.equal(r.last.dictating, false);
  r.kb.stop();
});

test('复制、选区、清空', async () => {
  const r = await ready('zh');
  await r.kb.act({ kind: 'text', text: 'hello' });
  await r.kb.act({ kind: 'copy' });
  assert.equal(r.clipboard.text, 'hello');
  await r.kb.act({ kind: 'range', start: 1, end: 3 });
  assert.deepEqual([r.last.selStart, r.last.selEnd], [1, 3]);
  await r.kb.act({ kind: 'copy' });
  assert.equal(r.clipboard.text, 'el');
  await r.type('ni');
  await r.kb.act({ kind: 'clear' });
  assert.equal(r.last.text, '');
  assert.equal(r.last.composition, '');
  r.kb.stop();
});

test('开关输出：只开关装着的输出组件(关着的也算)，别的 id 不做；清除各输出显示的内容照转', async () => {
  const r = await ready('zh');
  r.outputs = [{ id: 'a.out', name: 'A', on: true }, { id: 'b.out', name: 'B', on: false }];
  r.kb.refresh();
  await r.settle();
  assert.deepEqual(r.last.outputs, r.outputs);
  await r.kb.act({ kind: 'output', id: 'a.out', on: false });
  await r.kb.act({ kind: 'output', id: 'b.out', on: true });
  assert.deepEqual(r.switched, [['a.out', false], ['b.out', true]]);
  // 输入法自己、窗口组件、没装的组件、空串：都不是输出组件
  for (const id of ['yanuo.ime', 'yanuo.window-shell', 'x.none', '']) {
    await r.kb.act({ kind: 'output', id, on: false });
    await r.kb.act({ kind: 'output', id, on: true });
  }
  assert.equal(r.switched.length, 2);
  // 输出组件卸掉之后它的 id 也不做
  r.outputs = [];
  await r.kb.act({ kind: 'output', id: 'a.out', on: true });
  assert.equal(r.switched.length, 2);
  await r.kb.act({ kind: 'clearOutputs' });
  assert.equal(r.cleared, 1);
  r.kb.stop();
});

test('搜狗导入：rime 没就绪时不导入', async () => {
  const r = new Rig('zh');
  assert.deepEqual(await r.kb.importSogou(), { ok: false, error: '输入法尚未就绪' });
  r.kb.stop();
});

test('自动送出：文字没变的编辑(边界上的退格 / Delete、删了马上打回来、值没变的设置)不把同一句再送一遍', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = new Rig('en', { en: 'letter' });
  r.live = true;
  await r.kb.act({ kind: 'settings', patch: { autoSend: true } });
  // 停手够自动送出的时间，返回到这时送出去的文字
  const rested = async (): Promise<string[]> => {
    t.mock.timers.tick(1500);
    await new Promise(resolve => setImmediate(resolve));
    return r.sent.map(s => s.payload.text);
  };
  await r.type('a');
  assert.deepEqual(await rested(), ['a']);
  await r.key('Home');
  await r.key('Backspace');
  assert.deepEqual(await rested(), ['a']);
  await r.key('ArrowDown');
  await r.key('Delete');
  assert.deepEqual(await rested(), ['a']);
  await r.type('b');
  assert.deepEqual(await rested(), ['a', 'ab']);
  await r.key('Backspace');
  await r.type('b');
  assert.deepEqual(await rested(), ['a', 'ab']);
  await r.kb.act({ kind: 'settings', patch: { autoSend: true } });
  assert.deepEqual(await rested(), ['a', 'ab']);
  // 清空后再打出同一句照常送
  await r.kb.act({ kind: 'clear' });
  await r.type('ab');
  assert.deepEqual(await rested(), ['a', 'ab', 'ab']);
  assert.ok(r.sent.every(s => s.live && s.payload.notify));
  r.kb.stop();
});

test('setMode：前面的操作没做完时连改两种语言的模式，两个都留下', async () => {
  const r = await ready('zh');
  const release = r.ime.hold('key');
  const typed = r.key('KeyN');
  r.kb.setMode('zh', 'trad');
  r.kb.setMode('ja', 'hiragana');
  assert.deepEqual(r.settings.modes, {});
  release();
  await typed;
  await r.settle();
  assert.deepEqual(r.settings.modes, { zh: 'trad', ja: 'hiragana' });
  assert.deepEqual(r.ime.switches, { s2t: true });
  assert.equal(r.last.mode.id, 'trad');
  assert.equal(r.last.composition, 'n');
  r.kb.stop();
});
