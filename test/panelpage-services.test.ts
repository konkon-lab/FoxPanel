import test from 'node:test';
import assert from 'node:assert/strict';
import type { Plugin } from 'cordis';
import type { PageContext } from '@konkon-lab/foxpanel-sdk';
import type { CodeComponent } from '../src/shared/types.ts';

// 假的 window.fox：记下页面发给宿主的总线消息、频道登记和日志；deliver 像宿主那样把一条总线消息送进页面
const calls: unknown[][] = [];
let deliver: (channel: string, data: unknown) => void = () => undefined;
const fox = {
  busSend: (channel: string, data: unknown) => { calls.push(['send', channel, data]); },
  busListen: (channel: string, on: boolean) => { calls.push(['listen', channel, on]); },
  onBus: (fn: (channel: string, data: unknown) => void) => { deliver = fn; },
  logWrite: (source: string, text: string, level?: string) => { calls.push(['log', source, text, level]); },
  storageCall: () => Promise.resolve(null),
  onRelay: () => undefined,
  relayUse: () => Promise.resolve(),
  relayCall: () => Promise.resolve(undefined),
};
Object.assign(globalThis, { window: { fox } });

// services.ts 一加载就用 window.fox：在假接口装好之后加载
const { loadPlugin, reportWaiting } = await import('../src/panel/services.ts');
const { Context } = await import('cordis');

const comp = (id: string): CodeComponent => ({ id, kind: 'sidepage', name: id, config: {}, url: `fox://component/${id}/page.js` });
const take = (): unknown[][] => calls.splice(0);

test('页面里的总线：组件监听的频道向宿主登记一次，宿主送来的消息交给监听；组件发的消息本页直接送达并交给宿主', async () => {
  const root = new Context();
  const got: string[] = [];
  const listener = (who: string): Plugin => ({
    name: who,
    apply(ctx: PageContext) {
      ctx.bus.on('a.tts/play', data => got.push(`${who} play ${String(data)}`));
      ctx.bus.on(`${ctx.id}/own`, data => got.push(`${who} own ${String(data)}`));
      ctx.bus.on('talk', () => ctx.bus.send(`${ctx.id}/reply`, 'pong'));
    },
  });
  await loadPlugin(root, comp('a.one'), {}, listener('one'));
  await loadPlugin(root, comp('a.two'), {}, listener('two'));
  // 两个组件都听的频道只登记一次
  assert.deepEqual(take(), [
    ['listen', 'a.tts/play', true], ['listen', 'a.one/own', true], ['listen', 'talk', true],
    ['listen', 'a.two/own', true],
  ]);
  deliver('a.tts/play', 'mp3');
  deliver('a.two/own', 1);
  deliver('a.none/x', 2);
  assert.deepEqual(got, ['one play mp3', 'two play mp3', 'two own 1']);
  // 组件发的：交给宿主转出去
  deliver('talk', null);
  assert.deepEqual(take(), [['send', 'a.one/reply', 'pong'], ['send', 'a.two/reply', 'pong']]);
});

test('页面里的总线：组件加载失败时取消它登记的监听，没有别的组件在听的频道向宿主取消登记，并写进运行日志', async () => {
  const root = new Context();
  const keeper: Plugin = { name: 'keeper', apply(ctx: PageContext) { ctx.bus.on('shared/ch', () => undefined); } };
  const broken: Plugin = {
    name: 'broken',
    apply(ctx: PageContext) {
      ctx.bus.on('shared/ch', () => undefined);
      ctx.bus.on('a.bad/only', () => undefined);
      throw new Error('bad plugin');
    },
  };
  await loadPlugin(root, comp('a.keep'), {}, keeper);
  take();
  const error = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(loadPlugin(root, comp('a.bad'), {}, broken), /bad plugin/);
  } finally {
    console.error = error;
  }
  assert.deepEqual(take(), [
    ['listen', 'a.bad/only', true],
    ['log', 'a.bad', 'page load failed: bad plugin', 'error'],
    ['listen', 'a.bad/only', false],
  ]);
});

test('页面里的组件在等服务：不挡住后面的组件；查的时候每个等着的服务记一行日志，服务都有了组件自己起来，再查没有可记的', async () => {
  const root = new Context();
  const applied: string[] = [];
  const waiting: Plugin = { name: 'waiting', inject: ['kb', 'keys'], apply() { applied.push('waiting'); } };
  const ready: Plugin = { name: 'ready', apply() { applied.push('ready'); } };
  await loadPlugin(root, comp('a.part'), {}, waiting);
  await loadPlugin(root, comp('a.other'), {}, ready);
  assert.deepEqual(applied, ['ready']);
  take();
  reportWaiting(root);
  assert.deepEqual(take(), [
    ['log', 'a.part', 'waiting for service: kb', 'warn'],
    ['log', 'a.part', 'waiting for service: keys', 'warn'],
  ]);
  // 一个服务有了：只剩另一个
  const provider = (name: string): Plugin => ({ name: `provide-${name}`, apply(ctx: PageContext) { ctx.provide(name, {}); } });
  await loadPlugin(root, comp('a.ime'), {}, provider('kb'));
  reportWaiting(root);
  assert.deepEqual(take(), [['log', 'a.part', 'waiting for service: keys', 'warn']]);
  await loadPlugin(root, comp('a.keys'), {}, provider('keys'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, ['ready', 'waiting']);
  reportWaiting(root);
  assert.deepEqual(take(), []);
});
