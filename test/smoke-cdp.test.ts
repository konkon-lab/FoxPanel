// 冒烟脚本(scripts/smoke.ts)里不用启动程序的部分：命令行参数、调试协议的请求和事件、
// 页面返回值和报错的收窄、页面列表、运行日志的分拣、步骤的打印和退出码、离屏方式的模拟脚本和它的记录、读回的画面、检查用的面板组件、
// 窗口方式里显示方的设置和收起按钮、总开关那几步等的结果。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { PanelInfo } from '@konkon-lab/foxpanel-sdk';
import { applyCommand, type PanelsCommand } from '../components/_shared/panels/calls.ts';
import { emptyLayout, readSettings, shownSet, withCatalog } from '../components/_shared/panels/layout.ts';
import { anchorDefault, anchorPose, arrange, axis, glanceShown, mul, position, ray, rayQuad, type Mat34 } from '../components/steamvr/src/geometry.ts';
import { aimPose, encodePng, parseScript } from '../components/steamvr/src/sim.ts';
import {
  Cdp, clickedCenter, consoleError, displayConfig, evalValue, exceptionText, launchArgs, logProblems, pageCount, pageTargets, panelUrls, parseArgs, pngAlpha, seedPanels, simOffset, simProblems, simScript,
  simWheels, stepLines, summary, wristPoses,
} from '../scripts/smoke.ts';
import { parseManifest } from '../src/shared/manifest.ts';
import { sortByOrder } from '../src/main/components/settings.ts';
import type { LogEntry } from '../src/shared/types.ts';

// 一条连接和它发出去的消息(已解析)
function wire(timeoutMs?: number): { cdp: Cdp; sent: { id: number; method: string; params: unknown }[] } {
  const sent: { id: number; method: string; params: unknown }[] = [];
  const cdp = new Cdp(text => { sent.push(JSON.parse(text) as { id: number; method: string; params: unknown }); }, timeoutMs);
  return { cdp, sent };
}

test('命令行：不带参数不查边界，--boundary 查，别的参数报错', () => {
  assert.deepEqual(parseArgs([]), { boundary: false, exe: '' });
  assert.deepEqual(parseArgs(['--boundary']), { boundary: true, exe: '' });
  assert.throws(() => parseArgs(['--boundary', '--fast']), /--fast/);
});

test('命令行：--exe 给打包后的程序(取成绝对路径)；后面没有路径、和 --boundary 一起给时报错', () => {
  assert.deepEqual(parseArgs(['--exe', 'release/win-unpacked/FoxPanel.exe']), { boundary: false, exe: path.resolve('release/win-unpacked/FoxPanel.exe') });
  assert.throws(() => parseArgs(['--exe']), /--exe/);
  assert.throws(() => parseArgs(['--exe', '--boundary']), /--exe/);
  assert.throws(() => parseArgs(['--exe', 'FoxPanel.exe', '--boundary']), /--boundary/);
  assert.throws(() => parseArgs(['--boundary', '--exe', 'FoxPanel.exe']), /--boundary/);
  assert.throws(() => parseArgs(['FoxPanel.exe']), /FoxPanel\.exe/);
});

test('启动参数：仓库里的 Electron 带上仓库根，打包后的程序不带；都用给的数据文件夹、系统分配的调试端口', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const dev = launchArgs(false, 'D:\\tmp\\data');
  const packed = launchArgs(true, 'D:\\tmp\\data');
  assert.deepEqual(dev.slice(0, 3), [root, '--user-data-dir=D:\\tmp\\data', '--remote-debugging-port=0']);
  assert.deepEqual(packed, dev.slice(1));
  assert.ok(!packed.includes(root));
});

test('请求带递增的 id、方法名和参数，答复按 id 对上(不按到达顺序)', async () => {
  const { cdp, sent } = wire();
  const a = cdp.call('Runtime.enable');
  const b = cdp.call('Runtime.evaluate', { expression: '1 + 1' });
  assert.deepEqual(sent, [
    { id: 1, method: 'Runtime.enable', params: {} },
    { id: 2, method: 'Runtime.evaluate', params: { expression: '1 + 1' } },
  ]);
  cdp.receive(JSON.stringify({ id: 2, result: { result: { type: 'number', value: 2 } } }));
  cdp.receive(JSON.stringify({ id: 1, result: {} }));
  assert.deepEqual(await a, {});
  assert.deepEqual(await b, { result: { type: 'number', value: 2 } });
});

test('对方报错时请求失败，错误里有方法名和原因', async () => {
  const { cdp } = wire();
  const p = cdp.call('Input.dispatchMouseEvent', { type: 'bad' });
  cdp.receive(JSON.stringify({ id: 1, error: { code: -32602, message: 'Invalid parameters' } }));
  await assert.rejects(p, /Input\.dispatchMouseEvent：Invalid parameters/);
});

test('事件只分给监听这个方法的函数；不是 JSON、不是对象、对不上 id 的消息丢掉', async () => {
  const { cdp } = wire();
  const seen: unknown[] = [];
  cdp.on('Runtime.exceptionThrown', params => seen.push(params));
  cdp.on('Runtime.exceptionThrown', params => seen.push(params));
  cdp.receive(JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } }));
  cdp.receive(JSON.stringify({ method: 'Runtime.exceptionThrown', params: { n: 1 } }));
  assert.deepEqual(seen, [{ n: 1 }, { n: 1 }]);
  const p = cdp.call('Runtime.enable');
  cdp.receive('not json');
  cdp.receive('[1]');
  cdp.receive(JSON.stringify({ id: 7, result: 'stray' }));
  cdp.receive(JSON.stringify({ id: 1, result: 'mine' }));
  assert.equal(await p, 'mine');
});

test('连接断了：没等到答复的请求失败，之后的请求不发出去直接失败', async () => {
  const { cdp, sent } = wire();
  const p = cdp.call('Runtime.evaluate');
  cdp.closed('连接已断开');
  await assert.rejects(p, /Runtime\.evaluate：连接已断开/);
  await assert.rejects(cdp.call('Runtime.enable'), /Runtime\.enable：连接已断开/);
  assert.equal(sent.length, 1);
});

test('发不出去的请求失败', async () => {
  const cdp = new Cdp(() => { throw new Error('socket closed'); });
  await assert.rejects(cdp.call('Runtime.enable'), /Runtime\.enable：socket closed/);
});

test('到时间没有答复的请求失败，迟到的答复丢掉', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { cdp } = wire(2000);
  const p = cdp.call('Runtime.evaluate');
  const failed = assert.rejects(p, /Runtime\.evaluate：2 秒没有答复/);
  t.mock.timers.tick(2000);
  await failed;
  cdp.receive(JSON.stringify({ id: 1, result: {} }));
});

test('页面返回值：按值取出，没有值是 undefined；页面里抛了异常时抛出，答复格式不对也抛出', () => {
  assert.deepEqual(evalValue({ result: { type: 'object', value: { a: [1, '二'] } } }), { a: [1, '二'] });
  assert.equal(evalValue({ result: { type: 'undefined' } }), undefined);
  assert.throws(
    () => evalValue({ result: { type: 'object', subtype: 'error' }, exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is not a function\n    at <anonymous>:1:1' } } }),
    /^Error: Uncaught TypeError: x is not a function$/,
  );
  assert.throws(() => evalValue(null), /格式不对/);
});

test('异常转文字：说明加异常的第一行；抛的不是 Error 时用它的值；什么都没有时给固定文字', () => {
  assert.equal(exceptionText({ text: 'Uncaught (in promise)', exception: { description: 'Error: boom\n    at f (fox://host/a.js:1:2)' } }), 'Uncaught (in promise) Error: boom');
  assert.equal(exceptionText({ text: 'Uncaught', exception: { type: 'number', value: 42 } }), 'Uncaught 42');
  assert.equal(exceptionText({ text: 'Uncaught', exception: { type: 'string', value: '坏了' } }), 'Uncaught 坏了');
  assert.equal(exceptionText({}), '页面抛出了异常');
});

test('控制台：只收 error 和 assert，各参数取值或描述的第一行', () => {
  const args = [{ type: 'string', value: 'bus yanuo.ime/x' }, { type: 'object', subtype: 'error', description: 'Error: 坏了\n    at g' }, { type: 'number', value: 3 }];
  assert.equal(consoleError({ type: 'error', args }), 'bus yanuo.ime/x Error: 坏了 3');
  assert.equal(consoleError({ type: 'assert', args: [{ type: 'string', value: 'no' }] }), 'no');
  assert.equal(consoleError({ type: 'error', args: [] }), 'console.error');
  assert.equal(consoleError({ type: 'warning', args }), null);
  assert.equal(consoleError({ type: 'log', args }), null);
  assert.equal(consoleError('error'), null);
});

test('页面列表：只留 fox:// 的页面，别的类型、别的地址、缺字段的不要', () => {
  const list = [
    { type: 'page', url: 'fox://host/window/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/A' },
    { type: 'page', url: 'fox://yanuo.shell-classic.panel/panel.html', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/B' },
    { type: 'page', url: 'devtools://devtools/bundled/inspector.html', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/C' },
    { type: 'worker', url: 'fox://host/worker.js', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/D' },
    { type: 'page', url: 'fox://host/media.html' },
    'junk',
  ];
  assert.deepEqual(pageTargets(list), [
    { url: 'fox://host/window/index.html', socket: 'ws://127.0.0.1:1/devtools/page/A' },
    { url: 'fox://yanuo.shell-classic.panel/panel.html', socket: 'ws://127.0.0.1:1/devtools/page/B' },
  ]);
  assert.deepEqual(pageTargets({ error: 'x' }), []);
});

test('页面列表：页面的个数不管地址(开到外站的新窗口也算)，不是页面的不算；面板页面按地址里的 .panel 主机名认', () => {
  const page = (url: string): Record<string, string> => ({ type: 'page', url, webSocketDebuggerUrl: `ws://127.0.0.1:1/devtools/page/${url}` });
  const list = [
    page('fox://host/window/index.html'), page('fox://yanuo.shell-classic.panel/panel.html'), page('fox://yanuo.panel-clock.panel/panel.html'),
    page('fox://host/media.html'), page('https://smoke.invalid/'), page('fox://host/panel.html'),
    { type: 'worker', url: 'fox://host/worker.js' }, 'junk',
  ];
  assert.equal(pageCount(list), 6);
  assert.equal(pageCount({ error: 'x' }), 0);
  assert.deepEqual(panelUrls(pageTargets(list)), ['fox://yanuo.panel-clock.panel/panel.html', 'fox://yanuo.shell-classic.panel/panel.html']);
  assert.deepEqual(panelUrls([]), []);
});

test('运行日志：error 和 warn 各成一组，info 不算；组件的行带来源', () => {
  const entry = (level: LogEntry['level'], source: string, text: string): LogEntry => ({ id: 0, time: 0, level, source, text });
  assert.deepEqual(logProblems([
    entry('info', '', 'loaded 30 components'),
    entry('warn', 'yanuo.osc', 'port busy'),
    entry('error', '', 'main process exception: x'),
    entry('error', 'yanuo.keys', 'layout is invalid'),
  ]), {
    errors: ['main process exception: x', 'yanuo.keys：layout is invalid'],
    warns: ['yanuo.osc：port busy'],
  });
  assert.deepEqual(logProblems([]), { errors: [], warns: [] });
});

test('步骤的打印：通过或失败、名字、说明，附注缩进排在下面', () => {
  assert.deepEqual(stepLines({ name: '启动程序', ok: true, detail: '', notes: [] }), ['通过  启动程序']);
  assert.deepEqual(stepLines({ name: '运行日志', ok: true, detail: '有 1 行 warn', notes: ['warn  yanuo.osc：port busy'] }), ['通过  运行日志：有 1 行 warn', '      warn  yanuo.osc：port busy']);
  assert.deepEqual(stepLines({ name: '打字', ok: false, detail: '找不到 n 键', notes: [] }), ['失败  打字：找不到 n 键']);
});

test('退出码：全部通过为 0，有失败或一步都没跑为 1', () => {
  const ok = { name: 'a', ok: true, detail: '', notes: [] };
  const bad = { name: 'b', ok: false, detail: 'x', notes: [] };
  assert.deepEqual(summary([ok, ok]), { line: '2 步全部通过', code: 0 });
  assert.deepEqual(summary([ok, bad, bad]), { line: '3 步里 2 步失败', code: 1 });
  assert.equal(summary([]).code, 1);
});

test('离屏方式的模拟脚本：SteamVR 组件认得的格式；给头和左手的指尖、总开关显示面板、右手点键盘正中、左手点时钟正中再抓住它往右挪、往时钟发一次往下的滚轮、抬左手、左手扣扳机、右手点手腕时钟正中、放下左手，按时间先后，结果写进给的文件夹', () => {
  const out = path.resolve('sim-out');
  const script = parseScript(simScript(out), path.resolve('elsewhere'));
  assert.equal(script.out, out);
  const line = (s: (typeof script.steps)[number]): string => {
    if (s.kind === 'head') return 'head';
    if (s.kind === 'press') return `${s.hand} ${s.action} ${s.down}`;
    if (s.kind === 'aim') return `${s.hand} aim ${String(s.panel)} ${s.x},${s.y}`;
    if (s.kind === 'wheel') return `wheel ${s.panel} ${s.x},${s.y} ${s.dx},${s.dy}`;
    if (s.kind === 'tip') return `${s.hand} tip`;
    return s.kind === 'move' ? `${s.hand} move ${s.by.join(',')}` : `${s.hand} pose${s.pose ? '' : ' none'}`;
  };
  assert.deepEqual(script.steps.map(line), [
    'head', 'left tip',
    'right toggle true', 'right toggle false',
    'right aim yanuo.shell-classic 0.5,0.5', 'right click true', 'right click false',
    'left aim yanuo.panel-clock 0.5,0.5', 'left click true', 'left click false',
    'left grab true', 'left move 0.3,0,0', 'left grab false',
    'wheel yanuo.panel-clock 0.5,0.5 0,120',
    'left pose', 'left click true', 'left click false',
    'right aim yanuo.panel-wrist 0.5,0.5', 'right click true', 'right click false', 'right pose none',
    'left pose',
  ]);
  assert.ok(script.end > (script.steps.at(-1)?.at ?? 0));
  // 头和左手的指尖在第一帧就给(组件在手柄第一次出现时取指尖)
  assert.deepEqual(script.steps.slice(0, 2).map(s => s.at), [0, 0]);
  const at = (text: string): number => script.steps.find(s => line(s) === text)?.at ?? NaN;
  // 显示面板之后留出页面加载和接上页面的时间
  assert.ok(at('right aim yanuo.shell-classic 0.5,0.5') - at('right toggle true') >= 5000);
  // 握把按住半秒以上才挪手(过了抓取延迟)，挪完留一秒以上再松开
  assert.ok(at('left move 0.3,0,0') - at('left grab true') >= 500);
  assert.ok(at('left grab false') - at('left move 0.3,0,0') >= 1000);
  // 滚轮在松手之后、跑完之前，留出页面滚动的时间
  assert.ok(at('wheel yanuo.panel-clock 0.5,0.5 0,120') > at('left grab false'));
  assert.ok(script.end - at('wheel yanuo.panel-clock 0.5,0.5 0,120') >= 500);
  // 抬手在滚轮之后；左手的扳机在右手指上来之前按完；右手点完、移开之后才放下左手；放下之后留一秒以上才跑完
  const poses = script.steps.filter(s => s.kind === 'hand' && s.hand === 'left').map(s => s.at);
  const [raised = NaN, lowered = NaN] = poses;
  assert.equal(poses.length, 2);
  assert.ok(raised > at('wheel yanuo.panel-clock 0.5,0.5 0,120'));
  const leftClicks = script.steps.filter(s => s.kind === 'press' && s.hand === 'left' && s.action === 'click' && s.at > raised).map(s => s.at);
  assert.equal(leftClicks.length, 2);
  assert.ok(leftClicks.every(t => t > raised && t < at('right aim yanuo.panel-wrist 0.5,0.5')));
  const rightClicks = script.steps.filter(s => s.kind === 'press' && s.hand === 'right' && s.action === 'click' && s.at > raised).map(s => s.at);
  assert.ok(rightClicks.length === 2 && rightClicks.every(t => t - at('right aim yanuo.panel-wrist 0.5,0.5') >= 500 && t < at('right pose none')));
  assert.ok(lowered - at('right pose none') >= 500 && script.end - lowered >= 1000);
});

test('模拟脚本里手腕时钟的几个姿态：左手抬起时面板正对着眼睛(显示)，放下时背对着(不显示)；左手的射线一直从正面打在自己手上那块面板的正中；左手去指时钟、抓着它挪的那一段面板都不朝向眼睛', () => {
  const script = parseScript(simScript(path.resolve('sim-out')), path.resolve('elsewhere'));
  const head = script.steps.find(s => s.kind === 'head')?.pose ?? assert.fail('脚本里没有头的姿态');
  assert.deepEqual(head, [1, 0, 0, 0, 0, 1, 0, 1.6, 0, 0, 1, 0]);
  const tip = script.steps.find(s => s.kind === 'tip')?.pose ?? assert.fail('脚本里没有指尖');
  const [raised, lowered] = script.steps.flatMap(s => (s.kind === 'hand' && s.hand === 'left' && s.pose ? [s.pose] : []));
  assert.ok(raised && lowered);
  assert.deepEqual([tip, raised, lowered], [wristPoses().tip, wristPoses().raised, wristPoses().lowered]);
  const relative = anchorDefault('left');
  // 手腕时钟 240×120、宽 0.12 米
  const hit = (device: Mat34) => {
    const { source, dir } = ray(mul(device, tip));
    return rayQuad(source, dir, anchorPose(device, relative), 0.12, 240, 120);
  };
  for (const device of [raised, lowered]) {
    const h = hit(device);
    assert.deepEqual([h?.inside, h?.front], [true, true]);
    // 正中在四个像素的交界上：落在哪一个都算
    assert.ok(Math.abs((h?.x ?? NaN) - 119.5) < 1 && Math.abs((h?.y ?? NaN) - 59.5) < 1, `${h?.x},${h?.y}`);
    assert.ok(Math.abs((h?.distance ?? NaN) - 0.3) < 1e-9);
  }
  // 抬起：面板在眼睛前下方 0.4 米左右、法线正对着眼睛；放下：正面朝下
  const up = anchorPose(raised, relative);
  const eye = [0, 1.6, 0];
  const toEye = position(up).map((v, i) => (eye[i] ?? 0) - v);
  const reach = Math.hypot(...toEye);
  assert.ok(reach > 0.3 && reach < 0.5);
  axis(up, 2).forEach((v, i) => assert.ok(Math.abs(v - (toEye[i] ?? NaN) / reach) < 1e-9));
  assert.deepEqual([glanceShown(head, up, false), glanceShown(head, anchorPose(lowered, relative), true)], [true, false]);
  assert.ok(axis(anchorPose(lowered, relative), 2)[1] < -0.999);
  // 抬着的左手的射线穿过自己手上的面板以后，打不到键盘和挪到右边的时钟(各按 2 米见方算，留足余量)：左手扣扳机时没有别的面板收到按下
  const clockAt = arrange(head, 'front', []);
  const clockMoved: Mat34 = [...clockAt];
  clockMoved[3] += 0.3;
  const leftRay = ray(mul(raised, tip));
  for (const panel of [arrange(head, 'low', []), clockAt, clockMoved]) {
    const beyond = rayQuad(leftRay.source, leftRay.dir, panel, 2, 100, 100);
    assert.ok(!beyond || !beyond.inside, JSON.stringify(beyond));
  }
  // 左手指着时钟正中(时钟在面前、正面朝向眼睛，宽 0.3 米、480×200)：手柄摆成让指尖在落点正前方。这时和抓着它往右挪 0.3 米之后，
  // 手腕时钟的正面离眼睛的方向都在 40° 以上，不会显示出来
  const clock = clockAt;
  const inverse = (m: Mat34): Mat34 => {
    const [a, b, c, x, d, e, f, y, g, h, i, z] = m;
    return [a, d, g, -(a * x + d * y + g * z), b, e, h, -(b * x + e * y + h * z), c, f, i, -(c * x + f * y + i * z)];
  };
  const aiming = mul(aimPose(clock, 0.3, 200 / 480, 0.5, 0.5), inverse(tip));
  const moved: Mat34 = [...aiming];
  moved[3] += 0.3;
  for (const device of [aiming, moved]) {
    const wrist = anchorPose(device, relative);
    const to = position(wrist).map((v, i) => (eye[i] ?? 0) - v);
    const cos = axis(wrist, 2).reduce((sum, v, i) => sum + v * (to[i] ?? 0), 0) / Math.hypot(...to);
    assert.ok(cos < Math.cos(42 * Math.PI / 180), `夹角 ${(Math.acos(cos) * 180 / Math.PI).toFixed(1)}°`);
    assert.equal(glanceShown(head, wrist, false), false);
  }
});

test('检查用的面板组件：三块都是合格的面板清单，只有一块在清单里写了 panels；组件顺序里检查用的那块在时钟前面，凑数的在时钟后面', () => {
  const seeds = seedPanels();
  const manifests = seeds.map(seed => {
    const r = parseManifest(seed.manifest);
    if (!r.ok) assert.fail(r.errors.join('；'));
    return r.manifest;
  });
  assert.deepEqual(manifests.map(m => [m.id, m.kind, m.requires, m.uses, m.panel?.page]), [
    ['smoke.probe', 'panel', ['panels'], undefined, 'panel.js'],
    ['zsmoke.fill-a', 'panel', undefined, undefined, 'panel.js'],
    ['zsmoke.fill-b', 'panel', undefined, undefined, 'panel.js'],
  ]);
  assert.deepEqual(seeds.map(seed => seed.id), manifests.map(m => m.id));
  // 页面是一个默认导出插件的模块，名字是组件 id
  for (const seed of seeds) assert.match(seed.page, new RegExp(`^export default \\{\\n  name: '${seed.id}',`));
  // 没排进设置里的顺序的组件按 id 排：同时显示的上限是 4 时，键盘之后是检查用的那块、时钟、第一块凑数的，第二块凑数的排在上限之后
  const clock = parseManifest({ id: 'yanuo.panel-clock', kind: 'panel', name: 'Clock', version: '1.0.0', author: 'a', license: 'MIT', panel: { page: 'panel.js', width: 480, height: 200 } });
  if (!clock.ok) assert.fail(clock.errors.join('；'));
  const sorted = sortByOrder([clock.manifest, ...manifests].reverse().map(manifest => ({ manifest })), []);
  assert.deepEqual(sorted.map(c => c.manifest.id), ['smoke.probe', 'yanuo.panel-clock', 'zsmoke.fill-a', 'zsmoke.fill-b']);
});

test('窗口方式里收起按钮和总开关那几步等的结果：显示方的上限是 4、1 号快捷位是键盘；时钟用收起按钮收起、键盘关掉后总开关把两块都带回来，关着的第五块跟着算打开、排在上限之后不显示；再调五块整组收起、恢复后显示前四块', () => {
  const settings = readSettings(displayConfig());
  assert.deepEqual([settings.limit, settings.quick], [4, ['yanuo.shell-classic', null]]);
  // 面板目录的顺序：键盘、检查用的那块、时钟、两块凑数的
  const ids = ['yanuo.shell-classic', 'smoke.probe', 'yanuo.panel-clock', 'zsmoke.fill-a', 'zsmoke.fill-b'];
  const list = ids.map((id): PanelInfo => ({
    id, name: id, width: 320, height: 240, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2, anchor: 'world', spawn: 'front', glance: false, keep: false,
  }));
  let layout = withCatalog(emptyLayout(false), list);
  // 做一次调用，给出显示着的面板、有没有面板被总开关收起着、各块打开没有
  const after = (command: PanelsCommand): [string[], boolean, boolean[]] => {
    layout = applyCommand(layout, list, settings, command);
    return [shownSet(layout, settings), layout.stash.length > 0, ids.map(id => layout.panels[id]?.open === true)];
  };
  const four = ids.slice(0, 4);
  const hidden = ['yanuo.shell-classic', 'smoke.probe', 'zsmoke.fill-a'];
  // 冒烟脚本走到收起按钮时第五块关着
  assert.deepEqual(after({ kind: 'open', id: 'zsmoke.fill-b', on: false }), [four, false, [true, true, true, true, false]]);
  // 时钟用收起按钮收起(页面的 hide 就是 open 假)，到面前把它打开
  assert.deepEqual(after({ kind: 'open', id: 'yanuo.panel-clock', on: false }), [hidden, false, [true, true, false, true, false]]);
  assert.deepEqual(after({ kind: 'summon', id: 'yanuo.panel-clock' }), [four, false, [true, true, true, true, false]]);
  // 时钟再收起、键盘关掉，总开关把关着的三块都打开：键盘和时钟回来，第五块排在上限之后
  assert.deepEqual(after({ kind: 'open', id: 'yanuo.panel-clock', on: false }), [hidden, false, [true, true, false, true, false]]);
  assert.deepEqual(after({ kind: 'open', id: 'yanuo.shell-classic', on: false }), [['smoke.probe', 'zsmoke.fill-a'], false, [false, true, false, true, false]]);
  assert.deepEqual(after({ kind: 'toggleAll' }), [four, false, [true, true, true, true, true]]);
  // 整组收起、恢复
  assert.deepEqual(after({ kind: 'toggleAll' }), [[], true, [true, true, true, true, true]]);
  assert.deepEqual(after({ kind: 'toggleAll' }), [four, false, [true, true, true, true, true]]);
  // 常显的时钟不跟着收起
  after({ kind: 'set', id: 'yanuo.panel-clock', patch: { pinned: true } });
  assert.deepEqual(after({ kind: 'toggleAll' }), [['yanuo.panel-clock'], true, [true, true, true, true, true]]);
  assert.deepEqual(after({ kind: 'toggleAll' }), [four, false, [true, true, true, true, true]]);
});

test('模拟脚本的记录：每块面板有画面、纹理和清单的大小差不超过 1 像素、悬浮窗口显示着(用绝对位置放、只显示过一次)、正中只有一次按下和之后的松开才算对；各种不对都说得出是哪块', () => {
  const kb = {
    id: 'a.kb', image: 'C:/out/a.kb.png', texture: { width: 1400, height: 490 },
    overlay: { visible: true, meters: 0.8, pose: [1, 0, 0, 0, 0, 1, 0, 1.3, 0, 0, 1, -0.55], device: null }, shows: [{ at: 3020, on: true }],
    inputs: [{ kind: 'move', x: 700, y: 245, held: false, at: 11000 }, { kind: 'down', x: 701, y: 246, at: 12000 }, { kind: 'move', x: 701, y: 246, held: true, at: 12010 }, { kind: 'up', x: 701, y: 246, at: 12100 }],
  };
  const clock = {
    id: 'a.clock', image: 'C:/out/a.clock.png', texture: { width: 480, height: 200 },
    overlay: { visible: true, meters: 0.3, pose: [1, 0, 0, 0.29, 0, 1, 0, 1.55, 0, 0, 1, -0.65], device: null }, shows: [{ at: 3030, on: true }],
    inputs: [{ kind: 'down', x: 240, y: 100, at: 15000 }, { kind: 'up', x: 240, y: 100, at: 15100 }, { kind: 'leave', at: 16000 }],
  };
  const wants = [{ id: 'a.kb', width: 1400, height: 490 }, { id: 'a.clock', width: 480, height: 200 }];
  const good = { panels: [kb, clock] };
  assert.deepEqual(simProblems(good, wants), []);
  assert.deepEqual(simProblems({ panels: [clock, { ...kb, texture: { width: 1401, height: 489 } }] }, wants), []);
  const bad = (patch: Record<string, unknown>): string => simProblems({ panels: [{ ...kb, ...patch }, clock] }, wants).join('|');
  assert.match(bad({ image: null }), /^a\.kb：没有读回画面$/);
  assert.match(bad({ texture: null }), /^a\.kb：面板没有纹理/);
  assert.match(bad({ texture: { width: 1402, height: 490 } }), /^a\.kb：面板的纹理是 1402×490/);
  assert.match(bad({ texture: { width: 1400, height: 488 } }), /^a\.kb：面板的纹理是 1400×488/);
  assert.match(bad({ texture: { width: 480, height: 200 } }), /^a\.kb：面板的纹理是 480×200/);
  assert.match(bad({ overlay: { visible: false, device: null } }), /^a\.kb：悬浮窗口没有显示着$/);
  assert.match(bad({ overlay: null }), /^a\.kb：悬浮窗口没有显示着$/);
  // 留在空间里的面板不该用相对设备的调用放，也不该中途隐藏过
  assert.match(bad({ overlay: { ...kb.overlay, device: 0 } }), /^a\.kb：悬浮窗口最后一次不是用绝对位置放的\(相对 0 号设备\)$/);
  assert.match(bad({ overlay: { visible: true, meters: 0.8 } }), /^a\.kb：悬浮窗口最后一次不是用绝对位置放的/);
  assert.match(bad({ shows: [{ at: 3020, on: true }, { at: 9000, on: false }, { at: 9100, on: true }] }), /^a\.kb：悬浮窗口该只显示一次、不隐藏：show 3020、hide 9000、show 9100$/);
  assert.match(bad({ shows: [] }), /^a\.kb：悬浮窗口该只显示一次、不隐藏：没显示过$/);
  assert.match(bad({ inputs: [] }), /^a\.kb：指点事件里没有落在面板正中的按下/);
  assert.match(bad({ inputs: [{ kind: 'down', x: 10, y: 10 }, { kind: 'up', x: 10, y: 10 }] }), /^a\.kb：指点事件里没有落在面板正中的按下/);
  assert.match(bad({ inputs: [{ kind: 'up', x: 700, y: 245 }, { kind: 'down', x: 700, y: 245 }] }), /^a\.kb：按下之后没有松开$/);
  assert.match(bad({ inputs: 'none' }), /^a\.kb：指点事件里没有落在面板正中的按下/);
  // 另一只手的按下也落到了这块上
  assert.match(bad({ inputs: [...kb.inputs, { kind: 'down', x: 240, y: 100 }, { kind: 'up', x: 240, y: 100 }] }), /^a\.kb：收到 2 次按下/);
  // 时钟的问题记在时钟名下；少了一块面板
  assert.deepEqual(simProblems({ panels: [kb, { ...clock, image: null }] }, wants), ['a.clock：没有读回画面']);
  assert.deepEqual(simProblems({ panels: [kb] }, wants), ['a.clock：记录里没有这块面板(没开过页面)']);
  assert.equal(simProblems({ panels: [{ id: 'a.kb' }, { id: 'a.clock' }] }, wants).length, 10);
  assert.equal(simProblems({}, wants).length, 2);
  assert.deepEqual(simProblems(null, wants), ['记录不是对象']);

  // 一块面板比另一块偏右多少
  assert.ok(Math.abs((simOffset(good, 'a.clock', 'a.kb') ?? NaN) - 0.29) < 1e-12);
  assert.equal(simOffset({ panels: [kb, { ...clock, overlay: null }] }, 'a.clock', 'a.kb'), null);
  assert.equal(simOffset({ panels: [kb] }, 'a.clock', 'a.kb'), null);
  assert.equal(simOffset(null, 'a.clock', 'a.kb'), null);

  // 发给一块面板的滚轮
  const scrolled = { panels: [kb, { ...clock, inputs: [...clock.inputs, { kind: 'wheel', x: 240, y: 100, dx: 0, dy: 120, at: 21000 }, { kind: 'wheel', x: 240, y: 100, dx: 5, dy: -40, at: 21500 }] }] };
  assert.deepEqual(simWheels(scrolled, 'a.clock'), [120, -40]);
  assert.deepEqual([simWheels(scrolled, 'a.kb'), simWheels(good, 'a.clock'), simWheels(scrolled, 'a.none'), simWheels(null, 'a.clock')], [[], [], [], []]);
  // 滚轮不算按下：时钟照样只收到一次按下
  assert.deepEqual(simProblems(scrolled, wants), []);
});

test('模拟脚本的记录里附着在手上、抬手才显示的面板：悬浮窗口相对那个设备放，抬手之后显示一次、放下之后隐藏，另一只手指上来之前没有指点事件才算对', () => {
  const wrist = {
    id: 'a.wrist', image: 'C:/out/a.wrist.png', texture: { width: 240, height: 120 },
    overlay: { visible: false, meters: 0.12, pose: [0, -0.64, -0.77, -0.05, 0, -0.77, 0.64, 0, -1, 0, 0, 0.12], device: 1 },
    shows: [{ at: 22011, on: true }, { at: 25511, on: false }],
    inputs: [{ kind: 'move', x: 120, y: 60, held: false, at: 23011 }, { kind: 'down', x: 120, y: 60, at: 24011 }, { kind: 'up', x: 120, y: 60, at: 24111 }, { kind: 'leave', at: 25011 }],
  };
  const wants = [{ id: 'a.wrist', width: 240, height: 120, worn: { device: 1, raised: 22000, aimed: 23000, lowered: 25500 } }];
  assert.deepEqual(simProblems({ panels: [wrist] }, wants), []);
  const bad = (patch: Record<string, unknown>): string => simProblems({ panels: [{ ...wrist, ...patch }] }, wants).join('|');
  assert.match(bad({ overlay: { ...wrist.overlay, device: null } }), /^a\.wrist：悬浮窗口最后一次不是相对 1 号设备放的\(绝对位置\)$/);
  assert.match(bad({ overlay: { ...wrist.overlay, device: 2 } }), /^a\.wrist：悬浮窗口最后一次不是相对 1 号设备放的\(2 号设备\)$/);
  assert.match(bad({ overlay: { ...wrist.overlay, visible: true } }), /^a\.wrist：手放下以后悬浮窗口还显示着$/);
  assert.match(bad({ overlay: null }), /^a\.wrist：没有悬浮窗口$/);
  // 显示和隐藏：没显示过、抬手之前就显示着、另一只手指上来之后才显示、没隐藏、放下之前就隐藏了、抖了一下
  for (const shows of [
    [], [{ at: 3000, on: true }, { at: 25511, on: false }], [{ at: 23500, on: true }, { at: 25511, on: false }], [{ at: 22011, on: true }],
    [{ at: 22011, on: true }, { at: 24500, on: false }], [{ at: 22011, on: true }, { at: 22500, on: false }, { at: 22600, on: true }, { at: 25511, on: false }],
  ]) assert.match(bad({ shows }), /^a\.wrist：悬浮窗口该在抬手\(22000 毫秒\)之后显示、放下\(25500 毫秒\)之后隐藏，各一次：/, JSON.stringify(shows));
  // 附着的那只手的射线点到了它：另一只手指上来之前就有事件
  assert.match(bad({ inputs: [{ kind: 'move', x: 120, y: 60, held: false, at: 22100 }, ...wrist.inputs] }), /^a\.wrist：另一只手指上来\(23000 毫秒\)之前就有指点事件/);
  assert.match(
    bad({ inputs: [{ kind: 'down', x: 120, y: 60, at: 22500 }, { kind: 'up', x: 120, y: 60, at: 22600 }, ...wrist.inputs] }),
    /另一只手指上来\(23000 毫秒\)之前就有指点事件.*\|a\.wrist：收到 2 次按下/,
  );
  assert.match(bad({ inputs: [] }), /^a\.wrist：指点事件里没有落在面板正中的按下/);
  assert.match(bad({ image: null }), /^a\.wrist：没有读回画面$/);
  // 留在空间里的面板照附着的规矩查、附着的照留在空间里的规矩查，都不对
  assert.match(simProblems({ panels: [wrist] }, [{ id: 'a.wrist', width: 240, height: 120 }]).join('|'), /悬浮窗口没有显示着.*悬浮窗口该只显示一次、不隐藏/);
});

test('页面收到的鼠标事件：正中附近的按下和它之后的松开才算点到了', () => {
  assert.ok(clickedCenter(['mousedown 700,245', 'mouseup 700,245'], 1400, 490));
  assert.ok(clickedCenter(['mouseup 1,1', 'mousedown 702.5,243', 'mouseup 698,247.5'], 1400, 490));
  assert.ok(!clickedCenter(['mousedown 700,245'], 1400, 490));
  assert.ok(!clickedCenter(['mouseup 700,245', 'mousedown 700,245'], 1400, 490));
  assert.ok(!clickedCenter(['mousedown 704,245', 'mouseup 704,245'], 1400, 490));
  assert.ok(!clickedCenter(['mousedown 350,122', 'mouseup 350,122'], 1400, 490));
  assert.ok(!clickedCenter(['mousedown 700,245', 'mouseup 10,10'], 1400, 490));
  assert.ok(!clickedCenter([], 1400, 490));
});

test('读回的画面：量出宽高和不透明的像素数；全透明的是 0；不是 PNG、被截断的抛出', () => {
  // 3×2：一行不透明、一行透明(BGRA，预乘)
  const bgra = Buffer.from([10, 20, 30, 255, 0, 0, 0, 255, 5, 5, 5, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(pngAlpha(encodePng(3, 2, bgra)), { width: 3, height: 2, opaque: 3 });
  assert.deepEqual(pngAlpha(encodePng(4, 4, Buffer.alloc(64))), { width: 4, height: 4, opaque: 0 });
  assert.deepEqual(pngAlpha(encodePng(2, 1, Buffer.alloc(8, 255))), { width: 2, height: 1, opaque: 2 });
  assert.throws(() => pngAlpha(Buffer.from('not a png at all')), /PNG/);
  assert.throws(() => pngAlpha(encodePng(3, 2, bgra).subarray(0, 40)), /PNG/);
});
