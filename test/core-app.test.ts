import test from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge, type AppBridgeDeps } from '../src/main/app.ts';
import type { AppInfo, AppRequest, OutputInfo, OutputPayload } from '../src/shared/host-protocol.ts';
import { parseManifest, type ComponentKind } from '../src/shared/manifest.ts';
import type { Locale } from '../src/shared/types.ts';

// 应用信息里的一个组件：清单是按最少的字段校验出来的
function comp(id: string, kind: ComponentKind, on = true, active = on): AppInfo['components'][number] {
  const extra = kind === 'output' || kind === 'input' || kind === 'translator' ? { main: 'main.js' }
    : kind === 'lang' ? { ime: {} }
      : kind === 'service' ? { main: 'main.js', provides: ['keyboard'] } : { page: 'page.js' };
  const r = parseManifest({ id, kind, name: { en: id }, version: '1.0.0', author: 'test', license: 'MIT', ...extra });
  assert.ok(r.ok, id);
  return { id, kind, name: r.manifest.name, dir: `/components/${id}`, manifest: r.manifest, on, active };
}

interface Rig {
  bridge: AppBridge;
  state: {
    locale: Locale;
    components: AppInfo['components'];
    outputs: OutputInfo[];        // 各进程登记了的输出
    inputs: string[];             // 各进程里接了听写的输入源(按进程，不按组件顺序)
    typing: boolean;              // 开着的输出里有能显示「正在输入」的
  };
  pushed: AppInfo[];              // 推给组件进程的应用信息
  done: string[];                 // 交给组件进程和组件管理做的事
  clip: { text: string; fail: boolean };   // 系统剪贴板里的文字；fail = 读写都失败
  replies: unknown[][];           // 回给发请求的进程的
  ask(m: AppRequest): void;
}

function rig(over: Partial<AppBridgeDeps> = {}): Rig {
  const state: Rig['state'] = {
    locale: 'zh-Hans',
    components: [comp('a.shell', 'sidepage'), comp('a.out', 'output'), comp('b.out', 'output', false), comp('a.mic', 'input'), comp('b.mic', 'input'), comp('a.zh', 'lang')],
    outputs: [{ id: 'a.out', live: true, typing: false }],
    inputs: ['b.mic', 'a.mic'],
    typing: false,
  };
  const pushed: AppInfo[] = [];
  const done: string[] = [];
  const replies: unknown[][] = [];
  const clip = { text: 'copied', fail: false };
  const bridge = new AppBridge({
    hosts: () => ({
      outputs: state.outputs, inputs: state.inputs,
      send: (p: OutputPayload, live, ids) => { done.push(`send ${p.text}|${p.spoken}|${p.notify}|${live}|${ids.join(',')}`); return [...ids]; },
      hasTyping: ids => { done.push(`hasTyping ${ids.join(',')}`); return state.typing; },
      typing: on => { done.push(`typing ${on}`); },
      clear: () => { done.push('clear'); },
      dictate: on => { done.push(`dictate ${on}`); },
      translate: text => (text === 'boom' ? Promise.reject(new Error('no translator')) : Promise.resolve(`<${text}>`)),
      info: info => { pushed.push(info); },
    }),
    version: '1.2.3',
    packaged: true,
    locale: () => state.locale,
    components: () => state.components,
    setOn: (id, on) => { done.push(`setOn ${id} ${on}`); },
    clipboard: {
      readText: () => (clip.fail ? Promise.reject(new Error('locked')) : Promise.resolve(clip.text)),
      writeText: text => {
        if (clip.fail) return Promise.reject(new Error('locked'));
        clip.text = text;
        return Promise.resolve();
      },
    },
    ...over,
  });
  const host = { reply: (req: number, value: unknown, error?: string): void => { replies.push(error === undefined ? [req, value] : [req, value, error]); } };
  return { bridge, state, pushed, done, clip, replies, ask: m => bridge.message(m, host) };
}

test('应用信息：程序版本、是不是安装包里的程序、界面语言、装着的全部组件、输出组件的开关和登记情况、接了听写的输入源(按组件顺序)', () => {
  const r = rig();
  const info = r.bridge.info();
  assert.deepEqual([info.version, info.packaged], ['1.2.3', true]);
  assert.equal(info.locale, 'zh-Hans');
  assert.deepEqual(info.components, r.state.components);
  assert.deepEqual(info.outputs, [
    { id: 'a.out', name: { en: 'a.out' }, on: true, live: true, typing: false },
    { id: 'b.out', name: { en: 'b.out' }, on: false, live: false, typing: false },
  ]);
  assert.deepEqual([info.inputs, info.canDictate], [['a.mic', 'b.mic'], true]);
  // 组件带着目录和清单：语言组件的 ime 字段原样在清单里
  const lang = info.components.find(c => c.kind === 'lang');
  assert.deepEqual([lang?.dir, lang?.manifest.ime, lang?.active], ['/components/a.zh', {}, true]);
  r.state.outputs = [{ id: 'a.out', live: false, typing: true }, { id: 'b.out', live: true, typing: true }];
  r.state.inputs = [];
  const next = r.bridge.info();
  assert.deepEqual(next.outputs.map(o => [o.id, o.on, o.live, o.typing]), [['a.out', true, false, true], ['b.out', false, true, true]]);
  assert.deepEqual([next.inputs, next.canDictate], [[], false]);
});

test('应用信息：变了才推给组件进程，内容没变不推', () => {
  const r = rig();
  r.bridge.refresh();
  r.bridge.refresh();
  assert.equal(r.pushed.length, 1);
  assert.deepEqual(r.pushed[0], r.bridge.info());
  // 界面语言、组件的开关、输出的登记、听写的登记各变一次
  r.state.locale = 'ja';
  r.bridge.refresh();
  r.state.components = r.state.components.map(c => (c.id === 'b.out' ? { ...c, on: true, active: true } : c));
  r.bridge.refresh();
  r.state.outputs = [...r.state.outputs, { id: 'b.out', live: false, typing: true }];
  r.bridge.refresh();
  r.state.inputs = ['a.mic'];
  r.bridge.refresh();
  r.bridge.refresh();
  assert.deepEqual(r.pushed.slice(1).map(i => [i.locale, i.outputs.map(o => `${o.id}:${o.on}:${o.typing}`).join(' '), i.inputs.join(' ')]), [
    ['ja', 'a.out:true:false b.out:false:false', 'a.mic b.mic'],
    ['ja', 'a.out:true:false b.out:true:false', 'a.mic b.mic'],
    ['ja', 'a.out:true:false b.out:true:true', 'a.mic b.mic'],
    ['ja', 'a.out:true:false b.out:true:true', 'a.mic'],
  ]);
});

test('通用请求：发送只发给正在用的输出并回收到的组件；「正在输入」在有能显示的输出时才转；清除、听写、开关输出组件照转', () => {
  const r = rig();
  r.ask({ t: 'outSend', req: 1, payload: { text: 'hi', spoken: 'salut', notify: true }, live: false });
  r.ask({ t: 'outSend', req: 2, payload: { text: 'live', spoken: 'live', notify: false }, live: true });
  assert.deepEqual(r.done, ['send hi|salut|true|false|a.out', 'send live|live|false|true|a.out']);
  assert.deepEqual(r.replies, [[1, ['a.out']], [2, ['a.out']]]);
  r.done.length = 0;
  r.ask({ t: 'outTyping', on: true });
  r.state.typing = true;
  r.ask({ t: 'outTyping', on: true });
  r.ask({ t: 'outTyping', on: false });
  assert.deepEqual(r.done, ['hasTyping a.out', 'hasTyping a.out', 'typing true', 'hasTyping a.out', 'typing false']);
  r.done.length = 0;
  r.ask({ t: 'outClear' });
  r.ask({ t: 'inDictate', on: true });
  r.ask({ t: 'inDictate', on: false });
  r.ask({ t: 'setOn', id: 'b.out', on: true });
  r.ask({ t: 'setOn', id: 'a.out', on: false });
  assert.deepEqual(r.done, ['clear', 'dictate true', 'dictate false', 'setOn b.out true', 'setOn a.out false']);
  // 开着但没在用的输出(比如它要的服务没开)不收
  r.done.length = 0;
  r.state.components = r.state.components.map(c => (c.id === 'a.out' ? { ...c, active: false } : c));
  r.ask({ t: 'outSend', req: 3, payload: { text: 'x', spoken: 'x', notify: false }, live: false });
  assert.deepEqual(r.done, ['send x|x|false|false|']);
  assert.deepEqual(r.replies.at(-1), [3, []]);
});

test('通用请求：开关的只能是装着的输出组件(关着的、没在用的也算)，别的类别和没装的 id 不做', () => {
  const r = rig();
  r.state.components = [...r.state.components, comp('a.ime', 'service'), comp('a.win', 'window'), comp('c.out', 'output', true, false)];
  // 页面部件、输入源、语言、服务、主窗口页面、没装的组件、空串
  for (const id of ['a.shell', 'a.mic', 'a.zh', 'a.ime', 'a.win', 'x.none', '']) {
    r.ask({ t: 'setOn', id, on: false });
    r.ask({ t: 'setOn', id, on: true });
  }
  assert.deepEqual(r.done, []);
  r.ask({ t: 'setOn', id: 'b.out', on: true });
  r.ask({ t: 'setOn', id: 'c.out', on: false });
  assert.deepEqual(r.done, ['setOn b.out true', 'setOn c.out false']);
  // 输出组件卸掉之后它的 id 也不做
  r.state.components = r.state.components.filter(c => c.id !== 'b.out');
  r.ask({ t: 'setOn', id: 'b.out', on: false });
  assert.equal(r.done.length, 2);
});

test('通用请求：剪贴板读到文字回给发请求的进程，读不了回空串；写进系统剪贴板，写不了不抛出', async () => {
  const r = rig();
  const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
  r.ask({ t: 'clipRead', req: 1 });
  await settle();
  r.ask({ t: 'clipWrite', text: 'new' });
  assert.equal(r.clip.text, 'new');
  r.ask({ t: 'clipRead', req: 2 });
  await settle();
  r.clip.fail = true;
  r.ask({ t: 'clipRead', req: 3 });
  r.ask({ t: 'clipWrite', text: 'lost' });
  await settle();
  assert.deepEqual(r.replies, [[1, 'copied'], [2, 'new'], [3, '']]);
  assert.equal(r.clip.text, 'new');
  // 文字不是字符串的不写
  r.clip.fail = false;
  r.ask({ t: 'clipWrite', text: 5 } as unknown as AppRequest);
  assert.equal(r.clip.text, 'new');
});

test('通用请求：翻译回译文，出错回 error；进程消息里格式不对的字段不照做', async () => {
  const r = rig();
  r.ask({ t: 'trAsk', req: 1, text: 'hi' });
  r.ask({ t: 'trAsk', req: 2, text: 'boom' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(r.replies, [[1, '<hi>'], [2, null, 'no translator']]);
  r.replies.length = 0;
  // 组件进程发来的内容不可信：按 unknown 收窄
  const raw = (m: Record<string, unknown>): void => r.ask(m as unknown as AppRequest);
  raw({ t: 'outSend', req: 3, payload: 'text', live: false });
  raw({ t: 'outSend', req: 4, payload: { text: 'a' }, live: false });
  raw({ t: 'outSend', req: 5, payload: { text: 'a', spoken: 'b', notify: 'yes', more: 1 }, live: 'yes' });
  raw({ t: 'trAsk', req: 6, text: 5 });
  raw({ t: 'setOn', id: 5, on: true });
  raw({ t: 'setOn', id: 'a.out', on: 'yes' });
  raw({ t: 'inDictate', on: 1 });
  assert.deepEqual(r.replies, [[3, null, '参数不对'], [4, null, '参数不对'], [5, ['a.out']], [6, null, '参数不对']]);
  assert.deepEqual(r.done, ['send a|b|false|false|a.out', 'setOn a.out false', 'dictate false']);
});
