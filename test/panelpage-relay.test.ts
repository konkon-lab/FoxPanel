import test from 'node:test';
import assert from 'node:assert/strict';
import { isReactive, watchEffect } from 'vue';
import type { Caller, KeyboardState, RelayService } from '@konkon-lab/foxpanel-sdk';
import { EMPTY_KEYBOARD } from '../components/ime/src/empty.ts';
import { createRelay, type RelayApi } from '../src/panel/relay.ts';

// 假的 window.fox：记下订阅和调用；push 像宿主那样推一份状态(每次都是新对象)
interface Rig {
  relay: RelayService;
  used: [string, boolean][];
  called: [string, string, unknown[], boolean][];
  failures: string[];                               // 交给 failed 的(「在做的事: 错误」)
  refuse: Set<string>;                              // 宿主拒绝的服务名
  answer: (method: string) => unknown;              // 等结果的调用的结果
  push(name: string, state: unknown): void;
}

function rig(): Rig {
  const used: Rig['used'] = [];
  const called: Rig['called'] = [];
  const failures: string[] = [];
  const refuse = new Set<string>();
  const listeners: ((name: string, state: unknown) => void)[] = [];
  const r: Rig = {
    relay: undefined as unknown as RelayService, used, called, failures, refuse,
    answer: method => `done ${method}`,
    push: (name, state) => { for (const fn of listeners) fn(name, structuredClone(state)); },
  };
  const fox: RelayApi = {
    relayUse: (name, on) => {
      used.push([name, on]);
      return refuse.has(name) ? Promise.reject(new Error(`不允许调用 relay:use`)) : Promise.resolve();
    },
    relayCall: (name, method, args, wait) => {
      called.push([name, method, args, wait]);
      if (refuse.has(name)) return Promise.reject(new Error(`不允许调用 relay:call`));
      return Promise.resolve(wait ? r.answer(method) : undefined);
    },
    onRelay: fn => { listeners.push(fn); },
  };
  r.relay = createRelay(fox, (what, e) => failures.push(`${what}: ${e instanceof Error ? e.message : String(e)}`));
  return r;
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
const keyboard = (patch: Partial<KeyboardState> = {}): KeyboardState => ({ ...EMPTY_KEYBOARD, ...patch });

test('页面的远程服务：同一个名字只向宿主订阅一次，这一页的组件共用；状态到之前为 null', () => {
  const r = rig();
  const a = r.relay.use('keyboard');
  const b = r.relay.use('keyboard');
  assert.deepEqual(r.used, [['keyboard', true]]);
  assert.deepEqual([a.state, b.state], [null, null]);
  r.push('keyboard', keyboard({ text: 'x' }));
  assert.equal(a.state?.text, 'x');
  assert.equal(a.state, b.state);
  // 没订阅的名字的状态丢掉
  r.push('panels', { stowed: true });
  assert.equal(a.state?.text, 'x');
});

test('页面的远程服务：状态是响应式的，新状态只动内容变了的字段；提供者没了变 null，回来后是新的对象', async () => {
  const r = rig();
  const remote = r.relay.use('keyboard');
  const seen: string[] = [];
  let textRuns = 0;
  let candRuns = 0;
  watchEffect(() => { seen.push(remote.state === null ? 'null' : `ready:${remote.state.ready}`); });
  watchEffect(() => { textRuns++; void remote.state?.text; });
  watchEffect(() => { candRuns++; void (remote.state as Partial<KeyboardState> | null)?.candidates?.length; });
  // 每次都重新读(断言过是 null 之后，类型不跟着收窄)
  const now = (): Readonly<KeyboardState> | null => remote.state;
  r.push('keyboard', keyboard({ text: 'a', candidates: [{ index: 0, text: '啊' }] }));
  await tick();
  assert.ok(isReactive(remote.state));
  assert.deepEqual([seen, textRuns, candRuns], [['null', 'ready:false'], 2, 2]);
  const first = remote.state;
  // 只有 text 变了：读候选的那个不重算；对象还是同一个
  r.push('keyboard', keyboard({ text: 'ab', candidates: [{ index: 0, text: '啊' }] }));
  await tick();
  assert.deepEqual([remote.state?.text, textRuns, candRuns, remote.state === first], ['ab', 3, 2, true]);
  // 内容一样的再推一次：都不重算
  r.push('keyboard', keyboard({ text: 'ab', candidates: [{ index: 0, text: '啊' }] }));
  await tick();
  assert.deepEqual([textRuns, candRuns, seen.length], [3, 2, 2]);
  // 新状态里没有的字段删掉
  r.push('keyboard', { text: 'ab' });
  await tick();
  assert.deepEqual(remote.state, { text: 'ab' });
  // 提供者没了、又回来
  r.push('keyboard', null);
  await tick();
  assert.equal(now(), null);
  r.push('keyboard', keyboard({ ready: true }));
  await tick();
  assert.deepEqual([now()?.ready, now() === first], [true, false]);
  assert.deepEqual(seen, ['null', 'ready:false', 'ready:undefined', 'null', 'ready:true']);
});

test('页面的远程服务：状态不是对象(数组、字符串)时整个换掉', () => {
  const r = rig();
  // 约定之外的名字：这里只看状态的形状，不看类型
  const remote = (r.relay as unknown as { use(name: string): { readonly state: unknown } }).use('clock');
  r.push('clock', '12:00');
  assert.equal(remote.state, '12:00');
  r.push('clock', [1, 2]);
  assert.deepEqual(remote.state, [1, 2]);
  r.push('clock', { h: 12 });
  assert.deepEqual(remote.state, { h: 12 });
  r.push('clock', undefined);
  assert.equal(remote.state, null);
});

test('页面的远程服务：watch 每次状态到了都叫，取消后不叫；一个回调抛出异常不影响别的', () => {
  const r = rig();
  const remote = r.relay.use('keyboard');
  const got: string[] = [];
  const off = remote.watch(s => got.push(`a:${s?.text ?? 'null'}`));
  remote.watch(() => { throw new Error('boom'); });
  remote.watch(s => got.push(`b:${s?.text ?? 'null'}`));
  assert.deepEqual(got, []);
  r.push('keyboard', keyboard({ text: 'x' }));
  r.push('keyboard', null);
  off();
  off();
  r.push('keyboard', keyboard({ text: 'y' }));
  assert.deepEqual(got, ['a:x', 'b:x', 'a:null', 'b:null', 'b:y']);
  assert.deepEqual(r.failures, ['relay keyboard: boom', 'relay keyboard: boom', 'relay keyboard: boom']);
});

test('页面的远程服务：call 等宿主回结果，tell 不等、按发出的先后交给宿主；宿主拒绝的订阅和 tell 交给 failed', async () => {
  const r = rig();
  const remote = r.relay.use('keyboard');
  remote.tell('act', { kind: 'key', code: 'KeyA', shift: false });
  remote.tell('insert', 'x');
  const answered = remote.call('insert', 'y');
  remote.tell('dictationEnded');
  assert.deepEqual(r.called, [
    ['keyboard', 'act', [{ kind: 'key', code: 'KeyA', shift: false }], false],
    ['keyboard', 'insert', ['x'], false],
    ['keyboard', 'insert', ['y'], true],
    ['keyboard', 'dictationEnded', [], false],
  ]);
  assert.equal(await answered, 'done insert');
  await tick();
  assert.deepEqual(r.failures, []);
  // 宿主拒绝(这一页的组件没在清单里写这个名字)：订阅和 tell 的错误交给 failed，call 的错误给调用方
  const other = rig();
  other.refuse.add('keyboard');
  const refused = other.relay.use('keyboard');
  refused.tell('insert', 'x');
  await assert.rejects(refused.call('insert', 'y'), /不允许调用 relay:call/);
  await tick();
  assert.deepEqual(other.failures, ['relay keyboard: 不允许调用 relay:use', 'relay keyboard.insert: 不允许调用 relay:call']);
  assert.equal(refused.state, null);
});

test('页面的远程服务：页面里的组件不能提供', () => {
  const r = rig();
  const impl = { act: (_c: Caller) => undefined, insert: (_c: Caller) => undefined, dictated: (_c: Caller) => undefined, dictationEnded: (_c: Caller) => undefined };
  assert.throws(() => r.relay.serve('keyboard', impl), /页面里的组件不能提供远程服务/);
  assert.deepEqual([r.used, r.called], [[], []]);
});

// 类型：约定好的服务按 RemoteMap 检查方法名和参数
export function typed(relay: RelayService): void {
  const kb = relay.use('keyboard');
  kb.tell('act', { kind: 'send' });
  kb.tell('dictated', 'text', true);
  void kb.call('insert', 'x').then((r: void) => r);
  const ready: boolean | undefined = kb.state?.ready;
  void ready;
  // @ts-expect-error 没有这个服务
  relay.use('nope');
  // @ts-expect-error 没有这个方法
  kb.tell('nope');
  // @ts-expect-error 参数类型不对
  kb.tell('insert', 5);
  // @ts-expect-error 少了参数
  kb.tell('dictated', 'text');
  const serving = relay.serve('keyboard', {
    act: (caller: Caller, a: unknown) => void [caller, a],
    insert: () => undefined,
    dictated: () => undefined,
    dictationEnded: () => undefined,
  });
  serving.publish(EMPTY_KEYBOARD);
  // @ts-expect-error 状态的类型不对
  serving.publish({ ready: true });
  // @ts-expect-error 少了方法
  relay.serve('keyboard', { act: () => undefined });
}
