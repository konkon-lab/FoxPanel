import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { KeyboardSettings, OutputPayload } from '@konkon-lab/foxpanel-sdk';
import { Outbox } from '../components/ime/src/outbox.ts';
import { DEFAULT_KEYBOARD } from '../components/ime/src/settings.ts';

// 让等着的 promise 回调跑完
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

interface Rig {
  box: Outbox;
  env: { text: string; settings: KeyboardSettings; live: boolean; canType: boolean; translate: (text: string) => Promise<string>; refused: string | null };   // refused 有值时输出按这个原因失败
  sent: { payload: OutputPayload; live: boolean }[];
  typing: boolean[];
  logs: string[];
}

// 定时器换成假的；默认有收实时内容、能显示「正在输入」的输出
function rig(t: TestContext, settings: Partial<KeyboardSettings> = {}): Rig {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const env: Rig['env'] = { text: '', settings: { ...DEFAULT_KEYBOARD, ...settings }, live: true, canType: true, translate: text => Promise.resolve(text), refused: null };
  const sent: Rig['sent'] = [];
  const typing: boolean[] = [];
  const logs: string[] = [];
  const box = new Outbox({
    settings: () => env.settings,
    text: () => env.text,
    output: (payload, live) => {
      sent.push({ payload, live });
      return env.refused === null ? Promise.resolve([]) : Promise.reject(new Error(env.refused));
    },
    hasLive: () => env.live,
    hasTyping: () => env.canType,
    typing: on => { typing.push(on); },
    translate: text => env.translate(text),
    log: text => { logs.push(text); },
  });
  return { box, env, sent, typing, logs };
}

// 改输入框的文字并通知
function setText(r: Rig, text: string): void {
  r.env.text = text;
  r.box.textChanged();
}

test('自动送出：文字停下 1.5 秒后送一次实时内容，中途再变就重新计时', async t => {
  const r = rig(t, { autoSend: true });
  setText(r, 'he');
  t.mock.timers.tick(1000);
  setText(r, 'hello');
  t.mock.timers.tick(1499);
  await flush();
  assert.deepEqual(r.sent, []);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(r.sent, [{ payload: { text: 'hello', spoken: 'hello', notify: true }, live: true }]);
  // 文字不变时不重复送
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(r.sent.length, 1);
});

test('自动送出：清空后再打出同一句会再送；空文字、没开开关、没有收实时内容的输出时不送', async t => {
  const r = rig(t, { autoSend: true });
  setText(r, 'hello');
  t.mock.timers.tick(1500);
  await flush();
  setText(r, '');
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(r.sent.length, 1);
  setText(r, 'hello');
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(r.sent.length, 2);

  r.env.live = false;
  setText(r, 'a');
  t.mock.timers.tick(1500);
  r.env.live = true;
  r.env.settings = { ...r.env.settings, autoSend: false };
  setText(r, 'b');
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(r.sent.length, 2);
  // 计时中关掉开关：到时不送
  r.env.settings = { ...r.env.settings, autoSend: true };
  setText(r, 'c');
  r.env.settings = { ...r.env.settings, autoSend: false };
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(r.sent.length, 2);
});

test('自动送出：同一句只送一次——文字没变的编辑、改了又回到同一句、值没变的开关都不重发', async t => {
  const r = rig(t, { autoSend: true });
  // 等够自动送出的时间，返回到这时送出去的文字
  const rested = async (): Promise<string[]> => {
    t.mock.timers.tick(1500);
    await flush();
    return r.sent.map(s => s.payload.text);
  };
  setText(r, 'a');
  assert.deepEqual(await rested(), ['a']);
  // 光标移动、边界上的退格 / Delete：文字没变
  r.box.textChanged();
  assert.deepEqual(await rested(), ['a']);
  setText(r, 'ab');
  t.mock.timers.tick(500);
  setText(r, 'a');
  assert.deepEqual(await rested(), ['a']);
  r.box.settingsChanged({ autoSend: true }, r.box.showsTyping);
  assert.deepEqual(await rested(), ['a']);
  // 停在另一句上照常送，之后回到前一句也送
  setText(r, 'ab');
  assert.deepEqual(await rested(), ['a', 'ab']);
  setText(r, 'a');
  assert.deepEqual(await rested(), ['a', 'ab', 'a']);
  assert.ok(r.sent.every(s => s.live && s.payload.notify));
});

test('自动送出：手动发送后留在输入框里的同一句，再编辑时不重发', async t => {
  const r = rig(t, { autoSend: true });
  setText(r, 'hi');
  t.mock.timers.tick(1500);
  await flush();
  r.box.send('hi');
  await flush();
  r.box.textChanged();
  t.mock.timers.tick(1500);
  await flush();
  assert.deepEqual(r.sent.map(s => s.live), [true, false]);
});

test('自动送出：翻译回来时没发出去的不算送过；同一句有两次在等翻译时只发一次', async t => {
  const r = rig(t, { autoSend: true });
  const waiting: ((spoken: string) => void)[] = [];
  r.env.translate = () => new Promise(resolve => { waiting.push(resolve); });
  setText(r, 'a');
  t.mock.timers.tick(1500);
  setText(r, 'ab');
  waiting.shift()?.('A');
  await flush();
  assert.deepEqual(r.sent, []);
  setText(r, 'a');
  t.mock.timers.tick(1500);
  // 翻译还没回来时做了文字没变的编辑，又等到了时间
  r.box.textChanged();
  t.mock.timers.tick(1500);
  assert.equal(waiting.length, 2);
  for (const done of waiting) done('A');
  await flush();
  assert.deepEqual(r.sent, [{ payload: { text: 'a', spoken: 'A', notify: true }, live: true }]);
});

test('自动送出：打开开关时输入框里已有的文字也计时送出', async t => {
  const r = rig(t);
  setText(r, 'hi');
  r.env.settings = { ...r.env.settings, autoSend: true };
  r.box.settingsChanged({ autoSend: true }, r.box.showsTyping);
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(r.sent[0]?.payload.text, 'hi');
});

test('实时内容：翻译回来时输入框已经变了就不发', async t => {
  const r = rig(t, { autoSend: true });
  let translated = (_text: string): void => undefined;
  r.env.translate = () => new Promise(resolve => { translated = resolve; });
  setText(r, 'hello');
  t.mock.timers.tick(1500);
  r.env.text = 'hello!';
  translated('你好');
  await flush();
  assert.deepEqual(r.sent, []);
});

test('PIN：开启时马上显示一次，之后每 2 秒重发；输入框为空时不发，关掉后停', async t => {
  const r = rig(t);
  r.env.text = 'pin';
  r.env.settings = { ...r.env.settings, pinMessage: true };
  r.box.settingsChanged({ pinMessage: true }, r.box.showsTyping);
  await flush();
  assert.deepEqual(r.sent, [{ payload: { text: 'pin', spoken: 'pin', notify: false }, live: true }]);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(r.sent.length, 2);
  r.env.text = '  ';
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(r.sent.length, 2);
  r.env.text = 'pin';
  r.env.settings = { ...r.env.settings, pinMessage: false };
  r.box.settingsChanged({ pinMessage: false }, r.box.showsTyping);
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(r.sent.length, 2);
});

test('PIN：设置里本来就开着时一建好就开始，和 rime 无关', async t => {
  const r = rig(t, { pinMessage: true });
  r.env.text = 'pin';
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(r.sent.length, 1);
  r.box.stop();
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(r.sent.length, 1);
});

test('正在输入：打字时显示，6 秒没再打撤掉；关掉提示时马上撤掉；没有能显示的输出时不发', t => {
  const r = rig(t);
  r.box.typed();
  t.mock.timers.tick(5000);
  r.box.typed();
  t.mock.timers.tick(5999);
  assert.deepEqual(r.typing, [true, true]);
  t.mock.timers.tick(1);
  assert.deepEqual(r.typing, [true, true, false]);

  const was = r.box.showsTyping;
  r.env.settings = { ...r.env.settings, showTyping: false };
  r.box.settingsChanged({ showTyping: false }, was);
  assert.deepEqual(r.typing, [true, true, false, false]);
  r.box.typed();
  r.env.settings = { ...r.env.settings, showTyping: true };
  r.env.canType = false;
  r.box.typed();
  assert.equal(r.typing.length, 4);
});

test('发送：发给全部开着的输出，带译文；翻译失败用原文，同一句只试一次', async t => {
  const r = rig(t);
  r.env.translate = text => Promise.resolve(`<${text}>`);
  r.box.send(' hi ');
  await flush();
  r.box.send('');
  await flush();
  assert.deepEqual(r.sent, [
    { payload: { text: 'hi', spoken: '<hi>', notify: true }, live: false },
    { payload: { text: '', spoken: '', notify: true }, live: false },
  ]);

  let calls = 0;
  r.env.translate = () => {
    calls++;
    return Promise.reject(new Error('no key'));
  };
  r.box.send('bad');
  await flush();
  r.box.send('bad');
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(r.sent.slice(2).map(s => s.payload.spoken), ['bad', 'bad']);
  assert.deepEqual(r.logs, ['translate failed: no key']);
});

test('翻译失败且错误没有文字：照原文发出去；输出交不出去时只记一行警告', async t => {
  const r = rig(t);
  r.env.translate = () => Promise.reject(new Error(''));
  r.box.send('hi');
  await flush();
  assert.deepEqual(r.sent, [{ payload: { text: 'hi', spoken: 'hi', notify: true }, live: false }]);
  assert.deepEqual(r.logs, ['translate failed: ']);

  r.env.translate = text => Promise.resolve(text);
  r.env.refused = '参数不对';
  r.box.send('one');
  await flush();
  setText(r, 'live');
  r.env.settings = { ...r.env.settings, pinMessage: true };
  r.box.settingsChanged({ pinMessage: true }, r.box.showsTyping);
  await flush();
  assert.deepEqual(r.sent.slice(1).map(s => [s.payload.text, s.live]), [['one', false], ['live', true]]);
  assert.deepEqual(r.logs.slice(1), ['send failed: 参数不对', 'send failed: 参数不对']);
  r.box.stop();
});
