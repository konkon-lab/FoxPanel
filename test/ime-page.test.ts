import test from 'node:test';
import assert from 'node:assert/strict';
import { isReactive, watch } from 'vue';
import type { KbService, KeyboardState, PageContext } from '@konkon-lab/foxpanel-sdk';
import { EMPTY_KEYBOARD } from '../components/ime/src/empty.ts';
import imePage from '../components/ime/src/page.ts';
import { TEXT } from '../components/ime/src/words.ts';
import { createRelay, type RelayApi } from '../src/panel/relay.ts';

// 输入法的页面部分用到的那部分页面宿主
type HostContext = Pick<PageContext, 'relay' | 'overlay' | 'i18n'> & {
  provide(name: string, value: unknown): void;
  effect(fn: () => () => void): void;
  emit(name: string, ...args: unknown[]): void;
};

// 假的面板页面：远程服务是页面宿主的那一份，接在假的 window.fox 上；push 像宿主那样推一份状态(每次都是新对象)
interface Rig {
  ctx: HostContext;
  used: [string, boolean][];
  called: [string, string, unknown[], boolean][];
  events: unknown[][];                     // 页面部分发的事件(名字和参数)
  failures: string[];
  veils: string[];                         // 弹层的开和关(「open 选项」「close」)
  push(state: KeyboardState | null): void;
  load(): KbService;                       // 加载页面部分，返回它提供的 kb
}

function rig(): Rig {
  const used: Rig['used'] = [];
  const called: Rig['called'] = [];
  const events: unknown[][] = [];
  const failures: string[] = [];
  const veils: string[] = [];
  const listeners: ((name: string, state: unknown) => void)[] = [];
  const provided = new Map<string, unknown>();
  const fox: RelayApi = {
    relayUse: (name, on) => {
      used.push([name, on]);
      return Promise.resolve();
    },
    relayCall: (name, method, args, wait) => {
      called.push([name, method, args, wait]);
      return Promise.resolve(undefined);
    },
    onRelay: fn => { listeners.push(fn); },
  };
  const ctx: HostContext = {
    relay: createRelay(fox, (what, e) => failures.push(`${what}: ${String(e)}`)),
    // 弹层只记开和关，不画内容
    overlay: {
      open: (_render, options) => {
        veils.push(`open ${JSON.stringify(options)}`);
        return () => { veils.push('close'); };
      },
    },
    i18n: { locale: 'zh-Hans', text: t => (typeof t === 'string' ? t : '') },
    provide: (name, value) => { provided.set(name, value); },
    effect: fn => { fn(); },
    emit: (name, ...args) => { events.push([name, ...args]); },
  };
  return {
    ctx, used, called, events, failures, veils,
    push: state => { for (const fn of listeners) fn('keyboard', structuredClone(state)); },
    load: () => {
      imePage.apply(ctx as unknown as PageContext);
      return (provided.get('kb') ?? assert.fail('页面部分没有提供 kb')) as KbService;
    },
  };
}

const keyboard = (patch: Partial<KeyboardState> = {}): KeyboardState => ({ ...EMPTY_KEYBOARD, ready: true, ...patch });
const EN = { ...EMPTY_KEYBOARD.pack, id: 'test.en', short: 'EN', lang: 'en', modes: [{ id: 'letter', label: 'Letters', direct: true }] };

test('输入法的页面部分：订阅远程服务 keyboard 并提供 kb；状态到之前是空状态', () => {
  const r = rig();
  const kb = r.load();
  assert.deepEqual(r.used, [['keyboard', true]]);
  assert.ok(isReactive(kb.state));
  assert.deepEqual(JSON.parse(JSON.stringify(kb.state)), JSON.parse(JSON.stringify(EMPTY_KEYBOARD)));
  assert.equal(kb.state.ready, false);
  assert.equal(kb.pack.lang, 'und');
  assert.equal(kb.mode, kb.state.mode);
  assert.deepEqual(r.events, []);
});

test('输入法的页面部分：状态始终是同一个响应式对象，内容跟着远程服务；提供者没了回到空状态，回来后接上', () => {
  const r = rig();
  const kb = r.load();
  const state = kb.state;
  const empty = structuredClone(EMPTY_KEYBOARD);

  r.push(keyboard({ lang: EN.id, packs: [EN], pack: EN, mode: EN.modes[0]!, text: 'ab', caret: 2, uiLang: 'en' }));
  assert.equal(kb.state, state);
  assert.deepEqual([state.ready, state.text, state.caret, state.uiLang, kb.pack.id, kb.mode.id], [true, 'ab', 2, 'en', 'test.en', 'letter']);

  r.push(null);
  assert.equal(kb.state, state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), JSON.parse(JSON.stringify(empty)));

  r.push(keyboard({ text: 'c' }));
  assert.equal(kb.state, state);
  assert.deepEqual([state.ready, state.text], [true, 'c']);
  // 空状态本身没有被写过
  assert.deepEqual(EMPTY_KEYBOARD, empty);
  assert.deepEqual(r.failures, []);
});

test('输入法的页面部分：只有内容变了的字段触发依赖', () => {
  const r = rig();
  const kb = r.load();
  const first = keyboard({ packs: [EN], pack: EN, text: 'a', caret: 1, candidates: [{ index: 0, text: '你' }], outputs: [{ id: 'o', name: 'O', on: true }] });
  r.push(first);
  const fired: string[] = [];
  const fields = ['ready', 'packs', 'pack', 'mode', 'candidates', 'outputs', 'settings', 'text', 'caret'] as const;
  const stops = fields.map(f => watch(() => kb.state[f], () => fired.push(f), { flush: 'sync' }));
  const packs = kb.state.packs;

  // 只打了一个字：对象字段在新状态里都是新对象，内容没变
  r.push({ ...first, text: 'ab', caret: 2 });
  assert.deepEqual(fired, ['text', 'caret']);
  assert.equal(kb.state.packs, packs);

  fired.length = 0;
  r.push({ ...first, text: 'ab', caret: 2, candidates: [{ index: 0, text: '好' }], settings: { ...first.settings, autoSend: true } });
  assert.deepEqual(fired, ['candidates', 'settings']);
  assert.deepEqual([kb.state.candidates[0]?.text, kb.state.settings.autoSend], ['好', true]);

  // 一模一样的状态：什么都不触发
  fired.length = 0;
  r.push({ ...first, text: 'ab', caret: 2, candidates: [{ index: 0, text: '好' }], settings: { ...first.settings, autoSend: true } });
  assert.deepEqual(fired, []);

  // 提供者没了：回到空状态，值变了的字段和对象字段(换成空状态里的对象)各触发一次
  r.push(null);
  assert.deepEqual(fired, ['ready', 'packs', 'pack', 'mode', 'text', 'caret', 'candidates', 'outputs', 'settings']);
  for (const stop of stops) stop();
});

test('输入法的页面部分：这一页已经有键盘状态时，加载完就是它', () => {
  const r = rig();
  // 页面里别的代码用着同一个远程服务，状态已经到了
  const remote = r.ctx.relay.use('keyboard');
  r.push(keyboard({ text: 'x' }));
  assert.equal(remote.state?.text, 'x');
  const kb = r.load();
  assert.deepEqual([kb.state.ready, kb.state.text], [true, 'x']);
  assert.deepEqual(r.used, [['keyboard', true]]);
});

test('输入法的页面部分：每次状态到了发 kb/change(带着 kb 的状态)，翻页发 kb/page', () => {
  const r = rig();
  const kb = r.load();
  r.push(keyboard({ text: 'a' }));
  r.push(null);
  assert.deepEqual(r.events.map(e => e[0]), ['kb/change', 'kb/change']);
  assert.ok(r.events.every(e => e[1] === kb.state));
  kb.page(1);
  kb.page(-1);
  assert.deepEqual(r.events.slice(2), [['kb/page', 1], ['kb/page', -1]]);
});

test('输入法的页面部分：操作按发出的先后交给宿主，不等结果；开关输出是一个 output 操作', () => {
  const r = rig();
  const kb = r.load();
  assert.equal(kb.act({ kind: 'key', code: 'KeyA', shift: false }), undefined);
  kb.setOutput('a.out', false);
  kb.act({ kind: 'send' });
  assert.deepEqual(r.called, [
    ['keyboard', 'act', [{ kind: 'key', code: 'KeyA', shift: false }], false],
    ['keyboard', 'act', [{ kind: 'output', id: 'a.out', on: false }], false],
    ['keyboard', 'act', [{ kind: 'send' }], false],
  ]);
});

test('输入法的页面部分：没部署好(没有状态、ready 为假)期间开着一层点不掉的提示，部署好了关掉，提供者没了又盖上', () => {
  const r = rig();
  r.load();
  // 加载时还没有状态：立即盖上
  assert.deepEqual(r.veils, ['open {"dismiss":false}']);
  r.push(keyboard({ ready: false }));
  assert.equal(r.veils.length, 1);
  r.push(keyboard({ text: 'a' }));
  assert.deepEqual(r.veils.slice(1), ['close']);
  // 部署好之后的状态变化不动提示
  r.push(keyboard({ text: 'ab' }));
  assert.equal(r.veils.length, 2);
  // 输入法进程没了、重新部署：盖上；回来后关掉
  r.push(null);
  r.push(keyboard({ ready: false }));
  r.push(keyboard());
  assert.deepEqual(r.veils.slice(2), ['open {"dismiss":false}', 'close']);
});

test('输入法的页面部分：加载时已经部署好就不盖提示；要宿主的 overlay 和 i18n', () => {
  const r = rig();
  r.ctx.relay.use('keyboard');
  r.push(keyboard());
  r.load();
  assert.deepEqual(r.veils, []);
  assert.deepEqual(imePage.inject, ['overlay', 'i18n']);
});

test('输入法的页面部分：提示的文字五种界面语言都有，互不相同', () => {
  const words = (['zh-Hans', 'zh-Hant', 'ja', 'en', 'ko'] as const).map(lang => TEXT[lang].deploying);
  assert.equal(new Set(words).size, 5);
  assert.ok(words.every(Boolean));
});

test('输入法的页面部分：同一次按下里再来的退格、方向键标成连发，再按一次是新的', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const downs: (() => void)[] = [];
  const fake = { addEventListener: (_type: string, fn: () => void) => { downs.push(fn); }, removeEventListener: () => undefined };
  Object.defineProperty(globalThis, 'document', { value: fake, configurable: true, writable: true });
  try {
    const r = rig();
    const kb = r.load();
    const back = (): void => kb.act({ kind: 'key', code: 'Backspace', shift: false });
    const down = (): void => { for (const fn of downs) fn(); };
    down();
    back();
    back();
    back();
    down();
    back();
    for (const code of ['ArrowLeft', 'ArrowRight'] as const) {
      down();
      kb.act({ kind: 'key', code, shift: false });
      kb.act({ kind: 'key', code, shift: false });
    }
    assert.deepEqual(r.called.map(([, , args]) => (args[0] as { repeat?: boolean }).repeat), [false, true, true, false, false, true, false, true]);
  } finally {
    if (had) Object.defineProperty(globalThis, 'document', had);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
