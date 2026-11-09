import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readLayout } from '../components/_shared/panels/layout.ts';
import { FakeGpu, type FakeGpuObject } from '../components/steamvr/src/fake.ts';
import { arrange, IDENTITY, ray, uvToPixel } from '../components/steamvr/src/geometry.ts';
import { aimPose, createSim, encodePng, loadSim, parseScript, SIM_ENV, squareHit, type SimPanel, type SimResult, type SimScript } from '../components/steamvr/src/sim.ts';
import { at, CLOCK, DEVICE, KB, Rig, settingsWith, turned, WRIST, type RigOptions } from './vr-helpers.ts';

const DIR = path.resolve('sim-dir');

test('模拟脚本的收窄：七种步骤、默认值、结果文件夹相对脚本所在的文件夹', () => {
  const script = parseScript({
    end: 900,
    steps: [
      { at: 0, head: at(0, 1.6, 0) },
      { at: 0, hand: 'left', tip: at(0, 0.1, 0.3) },
      { at: 100, hand: 'left', pose: null },
      { at: 100, hand: 'left', pose: at(1, 2, 3) },
      { at: 200, hand: 'right', press: 'toggle', down: true },
      { at: 250, hand: 'left', press: 'quick1', down: true },
      { at: 300, hand: 'right', aim: [0.25, 0.75] },
      { at: 400, hand: 'right', aim: [0, 1], panel: 'yanuo.panel-clock' },
      { at: 500, hand: 'right', move: [0.3, 0, -0.1] },
      { at: 600, panel: 'yanuo.panel-clock', wheel: [0, 120] },
      { at: 700, panel: 'yanuo.panel-clock', wheel: [-30, 0], point: [0.25, 1] },
    ],
  }, DIR);
  assert.deepEqual(script, {
    out: DIR, hz: 90, end: 900,
    steps: [
      { at: 0, kind: 'head', pose: at(0, 1.6, 0) },
      { at: 0, kind: 'tip', hand: 'left', pose: at(0, 0.1, 0.3) },
      { at: 100, kind: 'hand', hand: 'left', pose: null },
      { at: 100, kind: 'hand', hand: 'left', pose: at(1, 2, 3) },
      { at: 200, kind: 'press', hand: 'right', action: 'toggle', down: true },
      { at: 250, kind: 'press', hand: 'left', action: 'quick1', down: true },
      { at: 300, kind: 'aim', hand: 'right', panel: null, x: 0.25, y: 0.75 },
      { at: 400, kind: 'aim', hand: 'right', panel: 'yanuo.panel-clock', x: 0, y: 1 },
      { at: 500, kind: 'move', hand: 'right', by: [0.3, 0, -0.1] },
      { at: 600, kind: 'wheel', panel: 'yanuo.panel-clock', x: 0.5, y: 0.5, dx: 0, dy: 120 },
      { at: 700, kind: 'wheel', panel: 'yanuo.panel-clock', x: 0.25, y: 1, dx: -30, dy: 0 },
    ],
  });
  assert.deepEqual(parseScript({ out: 'result', hz: 120, end: 0, steps: [] }, DIR), { out: path.join(DIR, 'result'), hz: 120, end: 0, steps: [] });
  assert.equal(parseScript({ out: path.resolve('elsewhere'), end: 0, steps: [] }, DIR).out, path.resolve('elsewhere'));
});

test('模拟脚本的收窄：格式不对的都报出是哪一步、哪一项', () => {
  const bad = (raw: unknown, message: RegExp): void => { assert.throws(() => parseScript(raw, DIR), message, JSON.stringify(raw)); };
  bad(null, /要是对象/);
  bad([], /要是对象/);
  bad({ end: 0 }, /steps 要是数组/);
  bad({ end: 0, steps: [], out: 5 }, /out 要是文件夹的路径/);
  bad({ end: 0, steps: [], hz: 0 }, /hz 要是 1–1000 的数/);
  bad({ end: 0, steps: [], hz: '90' }, /hz/);
  bad({ steps: [] }, /end 要是不小于最后一步的毫秒数/);
  bad({ end: 50, steps: [{ at: 100, head: IDENTITY }] }, /end 要是不小于最后一步的毫秒数/);
  bad({ end: 500, steps: [5] }, /第 1 步：要是对象/);
  bad({ end: 500, steps: [{ head: IDENTITY }] }, /第 1 步：at 要是不小于 0 的毫秒数/);
  bad({ end: 500, steps: [{ at: -1, head: IDENTITY }] }, /at 要是不小于 0 的毫秒数/);
  bad({ end: 500, steps: [{ at: 0, head: [1, 2, 3] }] }, /head 要是 12 个数/);
  bad({ end: 500, steps: [{ at: 0, head: IDENTITY }, { at: 0, hand: 'middle', pose: null }] }, /第 2 步：hand 要是 left 或 right/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', press: 'jump', down: true }] }, /press 要是 toggle、click、grab、quick1、quick2 之一/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', press: 'click', down: 1 }] }, /down 要是 true 或 false/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', aim: [0.5, 1.5] }] }, /aim 要是两个 0–1 的数/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', aim: 0.5 }] }, /aim 要是两个 0–1 的数/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', aim: [0.5, 0.5], panel: 'Not An Id' }] }, /panel 要是面板 id/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', aim: [0.5, 0.5], panel: 7 }] }, /panel 要是面板 id/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', move: [1, 2] }] }, /move 要是三个数/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', move: [1, 2, 'x'] }] }, /move 要是三个数/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left' }] }, /要有 head、wheel、press、aim、move、tip、pose 之一/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', tip: null }] }, /tip 要是 12 个数/);
  bad({ end: 500, steps: [{ at: 0, tip: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }] }, /hand 要是 left 或 right/);
  bad({ end: 500, steps: [{ at: 0, wheel: [0, 120] }] }, /wheel 要写 panel/);
  bad({ end: 500, steps: [{ at: 0, wheel: [0, 120], panel: 'Not An Id' }] }, /wheel 要写 panel/);
  bad({ end: 500, steps: [{ at: 0, wheel: [0], panel: 'a.kb' }] }, /wheel 要是两个数/);
  bad({ end: 500, steps: [{ at: 0, wheel: 120, panel: 'a.kb' }] }, /wheel 要是两个数/);
  bad({ end: 500, steps: [{ at: 0, wheel: [0, 120], panel: 'a.kb', point: [2, 0] }] }, /point 要是两个 0–1 的数/);
  bad({ end: 500, steps: [{ at: 0, wheel: [0, 120], panel: 'a.kb', point: 0.5 }] }, /point 要是两个 0–1 的数/);
  bad({ end: 500, steps: [{ at: 0, hand: 'left', pose: [Number.NaN] }] }, /pose 要是 12 个数或 null/);
  bad({ end: 500, steps: [{ at: 200, head: IDENTITY }, { at: 100, head: IDENTITY }] }, /第 2 步：at 不能比前一步小/);
});

test('求交：命中区域是边长等于宽度的正方形，u 从左到右、v 从下到上，正反面都算；平行、背向、落在外面都不中', () => {
  const pose = at(1, 2, -1);   // 正面朝 +Z
  const hit = squareHit([1.2, 2.1, 0], [0, 0, -1], pose, 0.8);
  assert.ok(hit);
  assert.ok(Math.abs(hit.u - 0.75) < 1e-12 && Math.abs(hit.v - 0.625) < 1e-12, `${hit.u} ${hit.v}`);
  assert.deepEqual(hit.point, [1.2, 2.1, -1]);
  // 横向的面板上下边之外、还在正方形里：照样中
  assert.ok(squareHit([1, 2.39, 0], [0, 0, -1], pose, 0.8));
  assert.equal(squareHit([1, 2.41, 0], [0, 0, -1], pose, 0.8), null);
  assert.equal(squareHit([1.41, 2, 0], [0, 0, -1], pose, 0.8), null);
  // 从背面打
  assert.ok(squareHit([1, 2, -2], [0, 0, 1], pose, 0.8));
  // 背向面板、和面板平行
  assert.equal(squareHit([1, 2, 0], [0, 0, 1], pose, 0.8), null);
  assert.equal(squareHit([1, 2, 0], [1, 0, 0], pose, 0.8), null);
});

test('指着面板上一点：手在这一点正前方，射线求交再换成像素正好是这一点；面板斜着也一样', () => {
  const panel = arrange(at(0.3, 1.6, 0.2), 'low', []);   // 向后仰着、朝着眼睛
  for (const [x, y] of [[0.5, 0.5], [0.07, 0.42], [0.99, 0.01], [0, 1]] as const) {
    const hand = aimPose(panel, 0.8, 490 / 1400, x, y);
    const { source, dir } = ray(hand);
    const hit = squareHit(source, dir, panel, 0.8);
    assert.ok(hit, `${x} ${y}`);
    // 落点换成像素：和直接按比例算的差不到一个像素
    const px = uvToPixel(Math.min(1, Math.max(0, hit.u)), hit.v, 1400, 490);
    assert.ok(px, `${x} ${y}`);
    assert.ok(Math.abs(px.x - x * 1400) <= 1 && Math.abs(px.y - y * 490) <= 1, `${x} ${y} → ${px.x} ${px.y}`);
    // 手离落点 0.3 米
    assert.ok(Math.abs(Math.hypot(...source.map((v, i) => v - (hit.point[i] ?? 0))) - 0.3) < 1e-9);
  }
});

// PNG 的各块：类型和数据；校验每块的 CRC
function chunks(png: Buffer): { type: string; data: Buffer }[] {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const list: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const body = png.subarray(at + 4, at + 8 + length);
    assert.equal(png.readUInt32BE(at + 8 + length), zlib.crc32(body));
    list.push({ type: body.subarray(0, 4).toString('latin1'), data: body.subarray(4) });
    at += 12 + length;
  }
  return list;
}

test('PNG：BGRA 换成 RGBA、还原成不预乘的颜色，每行前面一个滤波字节；块的长度和校验都对', () => {
  // 2×2：不透明的蓝、不透明的红、半透明的绿(预乘后 64)、全透明
  const bgra = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255, 0, 64, 0, 128, 9, 9, 9, 0]);
  const list = chunks(encodePng(2, 2, bgra));
  assert.deepEqual(list.map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual([...(list[0]?.data ?? [])], [0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
  assert.deepEqual([...zlib.inflateSync(list[1]?.data ?? Buffer.alloc(0))], [
    0, 0, 0, 255, 255, 255, 0, 0, 255,
    0, 0, 128, 0, 128, 0, 0, 0, 0,
  ]);
  assert.equal(list[2]?.data.length, 0);
});

// 模拟模式接上布局、面板表和会话：假的显卡和页面(键盘 1400×700、时钟 400×200)，时钟手动走；握把一按就抓起来、松手不吸正
function simRig(t: TestContext, script: SimScript, options: RigOptions = {}) {
  const saved = new Map<string, Buffer | string>();
  const gpus: FakeGpu[] = [];
  const readbacks: unknown[][] = [];
  const logs: string[] = [];
  const sim = createSim(script, {
    gpu: luid => {
      const gpu = new FakeGpu(luid);
      gpus.push(gpu);
      return gpu;
    },
    // 读回的像素：全是不透明的白
    readback: (gpu, texture, width, height) => {
      readbacks.push([gpu, texture, width, height]);
      return Buffer.alloc(width * height * 4, 255);
    },
    save: (file, data) => { saved.set(file, data); },
    log: (text, level) => { logs.push(level ? `${level}: ${text}` : text); },
  });
  const rig = new Rig(t, { backend: sim.backend, tap: sim.watch, settings: settingsWith({ grabDelay: 0, snap: false }), ...options });
  // 过 ms 毫秒，一帧 10 毫秒(100 Hz)
  const run = (ms: number): void => rig.frame(ms / 10);
  const result = (): SimResult => {
    const text = saved.get(path.join(script.out, 'result.json'));
    assert.equal(typeof text, 'string');
    return JSON.parse(String(text)) as SimResult;
  };
  return { sim, rig, logs, saved, gpus, readbacks, run, result };
}

const OUT = path.join(DIR, 'out');
const press = (at: number, hand: 'left' | 'right', action: 'toggle' | 'click' | 'grab' | 'quick1', down: boolean): SimScript['steps'][number] => ({ at, kind: 'press', hand, action, down });
const SCRIPT: SimScript = {
  out: OUT, hz: 100, end: 1500,
  steps: [
    press(100, 'right', 'toggle', true), press(150, 'right', 'toggle', false),
    { at: 300, kind: 'aim', hand: 'right', panel: 'a.kb', x: 0.25, y: 0.5 },
    press(400, 'right', 'click', true), press(450, 'right', 'click', false),
    { at: 500, kind: 'aim', hand: 'left', panel: 'a.clock', x: 0.5, y: 0.5 },
    press(600, 'left', 'click', true), press(650, 'left', 'click', false),
    { at: 700, kind: 'hand', hand: 'right', pose: null },
    press(800, 'left', 'grab', true),
    { at: 900, kind: 'move', hand: 'left', by: [0.3, 0.1, 0] },
    press(1300, 'left', 'grab', false),
  ],
};
// 一块面板收到的指点事件，写成「事件 x,y」
const inputsOf = (p: SimPanel | undefined): string[] => (p?.inputs ?? []).map(e => `${e.kind}${'x' in e ? ` ${e.x},${e.y}` : ''}${e.kind === 'move' && e.held ? ' held' : ''}`);

test('模拟模式：连上 → 总开关 → 两块面板都显示 → 分别指着扣扳机 → 抓住时钟移到一边；跑完每块读回一张 PNG，记下各块的悬浮窗口和指点事件', t => {
  const { rig, logs, saved, gpus, readbacks, run, result } = simRig(t, SCRIPT);
  rig.session.start();
  assert.equal(rig.session.connected, true);
  run(200);
  rig.page('a.kb').send(1);
  rig.page('a.clock').send(1);
  run(600);
  assert.equal(saved.size, 0);            // 还没到结束时间
  run(710);
  const [gpu] = gpus;
  assert.ok(gpu);
  assert.equal(gpu.luid, 0n);             // 默认显卡
  const [kbTexture, clockTexture] = gpu.objects.filter((o): o is Extract<FakeGpuObject, { kind: 'texture' }> => o.kind === 'texture');
  assert.deepEqual(readbacks, [[gpu, kbTexture, 1400, 700], [gpu, clockTexture, 400, 200]]);
  assert.deepEqual([...saved.keys()], [path.join(OUT, 'a.kb.png'), path.join(OUT, 'a.clock.png'), path.join(OUT, 'result.json')]);
  const size = (file: string): number[] => {
    const png = saved.get(path.join(OUT, file));
    assert.ok(Buffer.isBuffer(png));
    const header = chunks(png)[0]?.data ?? Buffer.alloc(8);
    return [header.readUInt32BE(0), header.readUInt32BE(4)];
  };
  assert.deepEqual([size('a.kb.png'), size('a.clock.png')], [[1400, 700], [400, 200]]);

  const { panels } = result();
  assert.deepEqual(panels.map(p => [p.id, p.image, p.texture]), [
    ['a.kb', path.join(OUT, 'a.kb.png'), { width: 1400, height: 700 }],
    ['a.clock', path.join(OUT, 'a.clock.png'), { width: 400, height: 200 }],
  ]);
  assert.deepEqual(panels.map(p => [p.overlay?.visible, p.overlay?.meters, p.overlay?.device]), [[true, 0.8, null], [true, 0.3, null]]);
  // 总开关键在 100 毫秒按下：下一帧建键盘的悬浮窗口并显示，再下一帧是时钟
  assert.deepEqual(panels.map(p => p.shows), [[{ at: 110, on: true }], [{ at: 120, on: true }]]);
  // 指点事件落在各自的面板上；连着一样的移动只记一次
  assert.deepEqual(inputsOf(panels[0]), ['move 350,350', 'down 350,350', 'move 350,350 held', 'up 350,350', 'move 350,350', 'leave']);
  // 时钟：点完之后被抓着挪走，手一下挪出去时射线离开了面板(移出)，面板跟上来以后又指着它
  const clockInputs = inputsOf(panels[1]);
  assert.deepEqual(clockInputs.slice(0, 6), ['move 200,100', 'down 200,100', 'move 200,100 held', 'up 200,100', 'move 200,100', 'leave']);
  assert.ok(clockInputs.slice(6).every(e => e.startsWith('move ') && !e.endsWith('held')), clockInputs.join('|'));
  assert.deepEqual(panels[0]?.inputs.map(e => e.at), [300, 400, 410, 450, 460, 700]);
  // 时钟被抓着挪了 (0.3, 0.1, 0)，键盘没动
  const clock = arrange(at(0, 1.6, 0), 'front', [[0, 1.3, -0.55]]);
  const moved = panels[1]?.overlay?.pose ?? [];
  [0.3, 0.1, 0].forEach((d, i) => assert.ok(Math.abs((moved[i * 4 + 3] ?? NaN) - clock[i * 4 + 3]! - d) < 1e-4, `${moved.join(',')}`));
  assert.deepEqual(panels[0]?.overlay?.pose, arrange(at(0, 1.6, 0), 'low', []));
  assert.deepEqual(logs, [`vr sim finished: ${OUT}`]);
  assert.deepEqual(rig.logs, ['steamvr connected', 'vr: a.kb 纹理 1400×700', 'vr: a.clock 纹理 400×200']);
  // 跑完之后照常连着，结果只写一次
  run(500);
  assert.equal(readbacks.length, 2);
  assert.equal(rig.session.connected, true);
  rig.session.stop();
});

test('模拟模式：不写 panel 的 aim 指着显示着的悬浮窗口里建得最早的那块；指不着、没有手可挪时记一行警告', t => {
  const { rig, logs, run, result } = simRig(t, {
    out: DIR, hz: 100, end: 600,
    steps: [
      { at: 0, kind: 'aim', hand: 'left', panel: null, x: 0.5, y: 0.5 },          // 还没有面板显示着
      { at: 0, kind: 'hand', hand: 'right', pose: null },
      { at: 10, kind: 'move', hand: 'right', by: [1, 0, 0] },                     // 右手的姿态无效
      press(100, 'right', 'toggle', true), press(150, 'right', 'toggle', false),
      { at: 300, kind: 'aim', hand: 'left', panel: null, x: 0.5, y: 0.5 },
      { at: 400, kind: 'aim', hand: 'left', panel: 'a.none', x: 0.5, y: 0.5 },    // 没有这块面板
    ],
  });
  rig.session.start();
  run(700);
  assert.deepEqual(logs, [
    'warn: vr sim: nothing to aim at (0 ms)', 'warn: vr sim: no hand to move (10 ms)', 'warn: vr sim: nothing to aim at (400 ms)', `vr sim finished: ${DIR}`,
  ]);
  const { panels } = result();
  assert.deepEqual(panels.map(p => [p.id, p.image, p.texture, p.overlay?.visible, inputsOf(p)]), [
    ['a.kb', null, null, true, ['move 700,350']],      // 没有画面时不存图，记录里写明
    ['a.clock', null, null, true, []],
  ]);
  rig.session.stop();
});

test('模拟模式：不写 panel 的 aim 不指隐藏着的悬浮窗口；几块都显示着时指悬浮窗口建得最早的那块，不看页面开的先后', t => {
  // 目录里时钟在前：键盘的页面连上就开着(清单写了 keep)，悬浮窗口却是时钟的先建。1 号快捷位指向时钟
  const { rig, run, result } = simRig(t, {
    out: DIR, hz: 100, end: 900,
    steps: [
      press(100, 'right', 'toggle', true), press(150, 'right', 'toggle', false),
      { at: 300, kind: 'aim', hand: 'left', panel: null, x: 0.5, y: 0.5 },
      press(450, 'right', 'quick1', true), press(500, 'right', 'quick1', false),      // 关掉时钟：它的悬浮窗口隐藏着留在那
      { at: 600, kind: 'aim', hand: 'left', panel: null, x: 0.5, y: 0.5 },
    ],
  }, { list: [CLOCK, KB], settings: settingsWith({ grabDelay: 0, snap: false }, { quick: ['a.clock', null] }) });
  rig.session.start();
  run(1000);
  assert.deepEqual(rig.opened, ['a.kb', 'a.clock']);
  const { panels } = result();
  const clock = panels.find(p => p.id === 'a.clock');
  const kb = panels.find(p => p.id === 'a.kb');
  assert.deepEqual([inputsOf(clock), clock?.inputs.map(e => e.at < 600)], [['move 200,100', 'leave'], [true, true]]);
  assert.deepEqual([inputsOf(kb), kb?.inputs.map(e => e.at >= 600)], [['move 700,350'], [true]]);
  assert.deepEqual([clock?.overlay?.visible, kb?.overlay?.visible], [false, true]);
  rig.session.stop();
});

test('模拟模式：附着在左手上、抬手才显示的面板——脚本给指尖和手的姿态；记下悬浮窗口最后一次是相对哪个设备放的、显示和隐藏的时间；右手指得到，左手的射线正对着也点不到', t => {
  // 面板在手柄上方 0.1 米、和手柄同朝向；左手的指尖在面板正前方 0.3 米朝着它
  const { rig, logs, run, result } = simRig(t, {
    out: DIR, hz: 100, end: 800,
    steps: [
      { at: 0, kind: 'tip', hand: 'left', pose: at(0, 0.1, 0.3) },
      { at: 100, kind: 'hand', hand: 'left', pose: at(0, 1.5, -0.4) },              // 抬到眼前：面板正对着眼睛
      press(200, 'left', 'click', true), press(250, 'left', 'click', false),
      { at: 300, kind: 'aim', hand: 'right', panel: 'a.wrist', x: 0.5, y: 0.5 },
      press(400, 'right', 'click', true), press(450, 'right', 'click', false),
      { at: 500, kind: 'hand', hand: 'right', pose: null },
      { at: 600, kind: 'hand', hand: 'left', pose: turned(-0.2, 1, 0.3) },          // 放下：面板背对着眼睛
      { at: 700, kind: 'aim', hand: 'right', panel: 'a.wrist', x: 0.5, y: 0.5 },    // 隐藏着的照样能让手对过去，只是点不到
    ],
  }, {
    list: [WRIST],
    layout: readLayout({ panels: { 'a.wrist': { open: true, pinned: true, locked: true, meters: null, anchor: 'left', glance: true, pose: at(0, 0.1, 0) } } }),
  });
  rig.session.start();
  run(150);
  rig.page('a.wrist').send(1);
  run(700);
  const [wrist] = result().panels;
  assert.deepEqual(wrist?.overlay, { visible: false, meters: 0.12, pose: at(0, 0.1, 0), device: DEVICE.left });
  assert.deepEqual(wrist?.shows, [{ at: 100, on: true }, { at: 600, on: false }]);
  assert.deepEqual([wrist?.image, wrist?.texture], [path.join(DIR, 'a.wrist.png'), { width: 240, height: 120 }]);   // 放下以后画面还在纹理里
  assert.deepEqual(inputsOf(wrist), ['move 120,60', 'down 120,60', 'move 120,60 held', 'up 120,60', 'move 120,60', 'leave']);
  assert.deepEqual(wrist?.inputs.map(e => e.at), [300, 400, 410, 450, 460, 500]);
  assert.deepEqual(logs, [`vr sim finished: ${DIR}`]);
  rig.session.stop();
});

test('模拟模式：给过指尖的手去指面板时，手柄摆成让指尖在落点正前方——指尖的射线照样落在那一点上', t => {
  // 左手的指尖：在手柄右前上方，绕 Y 转了 90°
  const { rig, run, result } = simRig(t, {
    out: DIR, hz: 100, end: 500,
    steps: [
      { at: 0, kind: 'tip', hand: 'left', pose: [0, 0, 1, 0.1, 0, 1, 0, 0.05, -1, 0, 0, -0.2] },
      press(100, 'right', 'toggle', true), press(150, 'right', 'toggle', false),
      { at: 300, kind: 'aim', hand: 'left', panel: 'a.kb', x: 0.25, y: 0.5 },
      { at: 400, kind: 'aim', hand: 'right', panel: 'a.clock', x: 0.5, y: 0.5 },
    ],
  });
  rig.session.start();
  run(600);
  const { panels } = result();
  assert.deepEqual([inputsOf(panels.find(p => p.id === 'a.kb')), inputsOf(panels.find(p => p.id === 'a.clock'))], [['move 350,350'], ['move 200,100']]);
  rig.session.stop();
});

test('模拟模式：跟着的设备姿态无效时指不着那块面板，记一行警告', t => {
  const { rig, logs, run } = simRig(t, {
    out: DIR, hz: 100, end: 500,
    steps: [
      { at: 0, kind: 'hand', hand: 'left', pose: at(0, 1.5, -0.4) },
      { at: 200, kind: 'hand', hand: 'left', pose: null },
      { at: 300, kind: 'aim', hand: 'right', panel: 'a.wrist', x: 0.5, y: 0.5 },
    ],
  }, {
    list: [WRIST],
    layout: readLayout({ panels: { 'a.wrist': { open: true, pinned: true, locked: true, meters: null, anchor: 'left', glance: false, pose: at(0, 0.1, 0) } } }),
  });
  rig.session.start();
  run(600);
  assert.deepEqual(logs, ['warn: vr sim: nothing to aim at (300 ms)', `vr sim finished: ${DIR}`]);
  rig.session.stop();
});

test('模拟模式：滚轮直接发给那块面板的页面，落点按纹理像素算，记进它的指点事件；没开过页面的面板记一行警告', t => {
  const { rig, logs, run, result } = simRig(t, {
    out: DIR, hz: 100, end: 600,
    steps: [
      { at: 0, kind: 'wheel', panel: 'a.kb', x: 0.5, y: 0.5, dx: 0, dy: 120 },      // 页面还没开
      press(100, 'right', 'toggle', true), press(150, 'right', 'toggle', false),
      { at: 300, kind: 'wheel', panel: 'a.clock', x: 0.5, y: 0.5, dx: 0, dy: 120 },
      { at: 400, kind: 'wheel', panel: 'a.clock', x: 0.25, y: 1, dx: -30, dy: -7.5 },
    ],
  });
  rig.session.start();
  run(700);
  assert.deepEqual(logs, ['warn: vr sim: nothing to scroll (0 ms)', `vr sim finished: ${DIR}`]);
  const clock = result().panels.find(p => p.id === 'a.clock');
  assert.deepEqual(clock?.inputs, [
    { kind: 'wheel', x: 200, y: 100, dx: 0, dy: 120, at: 300 },
    { kind: 'wheel', x: 100, y: 200, dx: -30, dy: -7.5, at: 400 },
  ]);
  assert.deepEqual(rig.page('a.clock').inputs, [{ kind: 'wheel', x: 200, y: 100, dx: 0, dy: 120 }, { kind: 'wheel', x: 100, y: 200, dx: -30, dy: -7.5 }]);
  assert.deepEqual(rig.page('a.kb').inputs, []);
  rig.session.stop();
});

test('模拟模式：脚本只跑一遍，断开之后不重新连；只开了页面、没显示过的面板记录里没有画面和悬浮窗口，没开过页面的不在记录里', t => {
  const { rig, saved, gpus, run, result } = simRig(t, { out: DIR, hz: 100, end: 50, steps: [] });
  rig.session.start();
  run(100);
  assert.deepEqual([...saved.keys()], [path.join(DIR, 'result.json')]);
  // 键盘的清单写了 keep：连上就开着页面；时钟没开过页面
  assert.deepEqual(result(), { panels: [{ id: 'a.kb', image: null, texture: null, overlay: null, shows: [], inputs: [] }] });
  rig.session.stop();
  rig.session.start();
  run(6000);
  assert.equal(rig.session.connected, false);
  assert.equal(gpus.length, 1);
});

test('模拟模式：读回或写文件出错只记一行错误，照常连着', t => {
  const { rig, logs, saved, run } = simRig(t, { out: DIR, hz: 100, end: 300, steps: [press(0, 'right', 'toggle', true)] });
  rig.session.start();
  run(50);
  rig.page('a.kb').send(1);
  run(50);
  t.mock.method(saved, 'set', () => { throw new Error('磁盘满了'); });
  run(300);
  assert.deepEqual(logs, ['error: vr sim failed: 磁盘满了']);
  assert.equal(rig.session.connected, true);
  rig.session.stop();
});

test('读脚本文件：记一行日志，结果文件夹相对脚本所在的文件夹；文件不在、不是 JSON、格式不对都抛出', t => {
  assert.equal(SIM_ENV, 'FOXPANEL_VR_SIM');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-vr-sim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'script.json');
  fs.writeFileSync(file, JSON.stringify({ out: 'out', end: 100, steps: [{ at: 0, hand: 'left', pose: null }] }));
  const logs: string[] = [];
  const sim = loadSim(file, text => { logs.push(text); });
  assert.deepEqual(logs, [`vr sim: ${file}`]);
  assert.equal(sim.backend.running(), true);   // 还没连过
  assert.throws(() => loadSim(path.join(dir, 'none.json'), () => undefined), /ENOENT/);
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => loadSim(file, () => undefined), SyntaxError);
  fs.writeFileSync(file, JSON.stringify({ end: 100 }));
  assert.throws(() => loadSim(file, () => undefined), /steps 要是数组/);
});
