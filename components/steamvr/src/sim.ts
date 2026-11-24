// 模拟模式：环境变量 FOXPANEL_VR_SIM 给一个脚本(JSON)时，组件不连 SteamVR，用不碰原生库的 Vr 加真的显卡设备跑这个脚本。
// 脚本按时间给头和手的姿态、指尖相对手柄的变换、手柄按键，也能直接往一块面板的页面发滚轮；跑完把每块开过页面的面板的常驻纹理读回存成 PNG，
// 各块的悬浮窗口(最后一次放它用的是绝对位置还是相对哪个设备、显示和隐藏的时间)和收到的指点事件记成 JSON。
// 脚本只跑一遍。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { LogLevel, PanelFeed, PanelInput } from '@konkon-lab/foxpanel-sdk';
import { errorText, isObject } from '../../_shared/util.ts';
import type { Gpu, Handle, Hit, VrBackend } from './api.ts';
import { D3D } from './d3d.ts';
import { FakeVr, type FakeOverlay } from './fake.ts';
import { applyDir, applyPoint, IDENTITY, invert, mul, type Mat34, type Vec3 } from './geometry.ts';
import { ROLE_LEFT, ROLE_RIGHT } from './openvr.ts';
import { overlayKey } from './surface.ts';

export const SIM_ENV = 'FOXPANEL_VR_SIM';   // 环境变量：模拟脚本的路径

const SIDES = ['left', 'right'] as const;
type Side = typeof SIDES[number];

// 脚本里的按键名 → 动作路径
const ACTIONS = {
  toggle: '/actions/main/in/OverlayToggle', click: '/actions/main/in/OverlayInteract', grab: '/actions/main/in/OverlayGrab',
  quick1: '/actions/main/in/PanelQuick1', quick2: '/actions/main/in/PanelQuick2',
} as const;
type ActionName = keyof typeof ACTIONS;

const ROLE: Record<Side, number> = { left: ROLE_LEFT, right: ROLE_RIGHT };
const DEVICE: Record<Side, number> = { left: 1, right: 2 };   // 两只手的设备序号
const SOURCE: Record<Side, string> = { left: '/user/hand/left', right: '/user/hand/right' };

const HEAD: Mat34 = [1, 0, 0, 0, 0, 1, 0, 1.6, 0, 0, 1, 0];   // 脚本没给头的姿态时：站在原点、眼睛高 1.6 米、朝 -Z 看
const HZ = 90;                  // 脚本没写刷新率时的值(Hz)
const HZ_MIN = 1;               // 脚本里刷新率的范围(Hz)
const HZ_MAX = 1000;
const AIM_DISTANCE = 0.3;       // 指着面板上一点时手离面板多远(米)
const PARALLEL_EPSILON = 1e-9;  // 射线方向在面板法线上的分量不到这么多算平行，打不中
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_RGBA_8 = [8, 6, 0, 0, 0];   // IHDR 的后五个字节：位深 8、颜色类型 RGBA、压缩 / 滤波 / 隔行都是 0
const RESULT_FILE = 'result.json';    // 结果文件夹里的记录；各块面板的画面是「面板 id.png」
const PANEL_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;   // 面板 id 的格式

// 脚本的一步；at = 连上之后多少毫秒做
export type SimStep =
  | { at: number; kind: 'head'; pose: Mat34 }                                      // 头的姿态
  | { at: number; kind: 'hand'; hand: Side; pose: Mat34 | null }                   // 一只手(手柄)的姿态；null = 姿态无效
  // 一只手的指尖相对手柄的变换；组件在这只手的设备第一次出现时取一次，要写在 at 为 0 的那一步
  | { at: number; kind: 'tip'; hand: Side; pose: Mat34 }
  // 一只手指着一块面板纹理上的 (x, y)：0–1，左上角为原点；panel 是面板 id，null = 显示着的悬浮窗口里建得最早的那块。
  // 跟着设备的悬浮窗口按那个设备这一刻的姿态算在哪；脚本给过这只手的指尖时，手柄摆成让指尖在落点正前方
  | { at: number; kind: 'aim'; hand: Side; panel: string | null; x: number; y: number }
  | { at: number; kind: 'move'; hand: Side; by: Vec3 }                             // 一只手从这时的位置平移(米，面板空间)
  | { at: number; kind: 'press'; hand: Side; action: ActionName; down: boolean }   // 按下或松开一个键
  // 往一块面板的页面发一次滚轮(不经手柄)：落在纹理上的 (x, y)(0–1，左上角为原点)，滚动量 dx、dy(像素，dy 为正往下滚)
  | { at: number; kind: 'wheel'; panel: string; x: number; y: number; dx: number; dy: number };

export interface SimScript {
  out: string;        // 结果放在哪个文件夹(绝对路径)
  hz: number;         // 头显刷新率(Hz)
  end: number;        // 连上之后多少毫秒算跑完
  steps: SimStep[];   // 按 at 从小到大
}

const isSide = (v: unknown): v is Side => (SIDES as readonly unknown[]).includes(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isMat = (v: unknown): v is Mat34 => Array.isArray(v) && v.length === 12 && v.every(isNumber);
const isAction = (v: unknown): v is ActionName => typeof v === 'string' && Object.hasOwn(ACTIONS, v);

// 脚本里的一步收窄；格式不对时抛出异常
function parseStep(raw: unknown, index: number): SimStep {
  const bad = (what: string): never => { throw new Error(`模拟脚本第 ${index + 1} 步：${what}`); };
  if (!isObject(raw)) return bad('要是对象');
  const { at, head, hand, pose, tip, aim, panel, move, press, down, wheel, point } = raw;
  if (!isNumber(at) || at < 0) return bad('at 要是不小于 0 的毫秒数');
  if (head !== undefined) return isMat(head) ? { at, kind: 'head', pose: head } : bad('head 要是 12 个数');
  if (wheel !== undefined) {
    const [dx, dy] = Array.isArray(wheel) ? wheel as unknown[] : [];
    const [x, y] = point === undefined ? [0.5, 0.5] : Array.isArray(point) ? point as unknown[] : [];
    if (!(typeof panel === 'string' && PANEL_ID.test(panel))) return bad('wheel 要写 panel(面板 id)');
    if (!isNumber(dx) || !isNumber(dy)) return bad('wheel 要是两个数');
    return isNumber(x) && isNumber(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { at, kind: 'wheel', panel, x, y, dx, dy } : bad('point 要是两个 0–1 的数');
  }
  if (!isSide(hand)) return bad('hand 要是 left 或 right');
  if (press !== undefined) {
    return isAction(press) && typeof down === 'boolean' ? { at, kind: 'press', hand, action: press, down }
      : bad(`press 要是 ${Object.keys(ACTIONS).join('、')} 之一，down 要是 true 或 false`);
  }
  if (aim !== undefined) {
    const [x, y] = Array.isArray(aim) ? aim as unknown[] : [];
    if (panel !== undefined && !(typeof panel === 'string' && PANEL_ID.test(panel))) return bad('panel 要是面板 id');
    return isNumber(x) && isNumber(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { at, kind: 'aim', hand, panel: panel ?? null, x, y } : bad('aim 要是两个 0–1 的数');
  }
  if (move !== undefined) {
    const by = Array.isArray(move) ? move as unknown[] : [];
    const [dx, dy, dz] = by;
    return by.length === 3 && isNumber(dx) && isNumber(dy) && isNumber(dz) ? { at, kind: 'move', hand, by: [dx, dy, dz] } : bad('move 要是三个数');
  }
  if (tip !== undefined) return isMat(tip) ? { at, kind: 'tip', hand, pose: tip } : bad('tip 要是 12 个数');
  if (pose === null || isMat(pose)) return { at, kind: 'hand', hand, pose };
  return bad('要有 head、wheel、press、aim、move、tip、pose 之一，pose 要是 12 个数或 null');
}

// 脚本(JSON 解出来的值)收窄；dir = 脚本所在的文件夹，out 写相对路径时相对它，不写时就是它。格式不对时抛出异常
export function parseScript(raw: unknown, dir: string): SimScript {
  if (!isObject(raw)) throw new Error('模拟脚本要是对象');
  const { out, hz, end, steps } = raw;
  if (out !== undefined && typeof out !== 'string') throw new Error('模拟脚本：out 要是文件夹的路径');
  if (hz !== undefined && !(isNumber(hz) && hz >= HZ_MIN && hz <= HZ_MAX)) throw new Error(`模拟脚本：hz 要是 ${HZ_MIN}–${HZ_MAX} 的数`);
  if (!Array.isArray(steps)) throw new Error('模拟脚本：steps 要是数组');
  const list = (steps as unknown[]).map(parseStep);
  list.forEach((s, i) => {
    if (s.at < (list[i - 1]?.at ?? 0)) throw new Error(`模拟脚本第 ${i + 1} 步：at 不能比前一步小`);
  });
  const last = list.at(-1)?.at ?? 0;
  if (!isNumber(end) || end < last) throw new Error('模拟脚本：end 要是不小于最后一步的毫秒数');
  return { out: path.resolve(dir, out ?? '.'), hz: hz ?? HZ, end, steps: list };
}

const el = (v: readonly number[], i: number): number => v[i] ?? 0;

// 射线(起点 source、方向 dir)和悬浮窗口求交，结果和 SteamVR 给的一样：命中区域是以悬浮窗口的原点为中心、边长等于宽度的正方形，
// 不分正反面；u 从左到右、v 从下到上。没打中时为 null
export function squareHit(source: readonly number[], dir: readonly number[], pose: Mat34, meters: number): Hit | null {
  const local = invert(pose);
  const o = applyPoint(local, source);
  const d = applyDir(local, dir);
  if (Math.abs(d[2]) < PARALLEL_EPSILON) return null;
  const t = -o[2] / d[2];
  if (t < 0) return null;
  const u = (o[0] + d[0] * t) / meters + 0.5;
  const v = (o[1] + d[1] * t) / meters + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, point: [el(source, 0) + el(dir, 0) * t, el(source, 1) + el(dir, 1) * t, el(source, 2) + el(dir, 2) * t] };
}

// 一只手指着面板上一点时的姿态：(x, y) 是纹理上的位置(0–1，左上角为原点)，aspect = 纹理的高 / 宽。
// 手在这一点正前方 AIM_DISTANCE 米，朝向和面板相同(手的前方 -Z 正对着面板的正面)
export function aimPose(panel: Mat34, meters: number, aspect: number, x: number, y: number): Mat34 {
  const p = applyPoint(panel, [(x - 0.5) * meters, (0.5 - y) * meters * aspect, AIM_DISTANCE]);
  const m: Mat34 = [...panel];
  m[3] = p[0];
  m[7] = p[1];
  m[11] = p[2];
  return m;
}

// BGRA(预乘透明度，每行 width×4 字节，从上到下)编成 PNG(RGBA，不预乘)
export function encodePng(width: number, height: number, bgra: Buffer): Buffer {
  const stride = width * 4 + 1;   // 每行前面一个滤波方式的字节(0 = 不滤波)
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = y * stride + 1 + x * 4;
      const a = bgra[from + 3] ?? 0;
      const straight = (c: number | undefined): number => (a ? Math.min(255, Math.round((c ?? 0) * 255 / a)) : 0);
      raw[to] = straight(bgra[from + 2]);
      raw[to + 1] = straight(bgra[from + 1]);
      raw[to + 2] = straight(bgra[from]);
      raw[to + 3] = a;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const frame = Buffer.alloc(8 + body.length);
    frame.writeUInt32BE(data.length, 0);
    body.copy(frame, 4);
    frame.writeUInt32BE(zlib.crc32(body), 4 + body.length);
    return frame;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set(PNG_RGBA_8, 8);
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 记下来的一个指点事件；at = 连上之后多少毫秒发的
export type SimInput = PanelInput & { at: number };

// 一块面板的悬浮窗口跑完时的样子：pose 是最后一次放它时给的矩阵，device 是那一次相对哪个设备(设备序号)，null = 面板空间里的绝对位置
export interface SimOverlay {
  visible: boolean;
  meters: number;
  pose: Mat34;
  device: number | null;
}

// 一块开过页面的面板跑完时的样子
export interface SimPanel {
  id: string;
  image: string | null;                                                    // 画面存在哪；没有画面时为 null
  texture: { width: number; height: number } | null;                       // 常驻纹理的像素
  overlay: SimOverlay | null;                                              // 悬浮窗口；没建或已经销毁时为 null
  shows: { at: number; on: boolean }[];                                    // 悬浮窗口每次显示(on 为真)和隐藏：at = 连上之后多少毫秒
  inputs: SimInput[];                                                      // 发给页面的指点事件；连着几次一样的移动只记一次
}

// 跑完写进 result.json 的记录：开过页面的面板，按开的先后
export interface SimResult {
  panels: SimPanel[];
}

export interface SimDeps {
  gpu(luid: bigint): Gpu;                                                          // 建显卡设备
  readback(gpu: Gpu, texture: unknown, width: number, height: number): Buffer;     // 把纹理读回内存(BGRA，每行 width×4 字节)
  save(file: string, data: Buffer | string): void;                                 // 写一个结果文件(文件夹不在时建)
  log(text: string, level?: LogLevel): void;
}

export interface Sim {
  backend: VrBackend;                  // 代替 SteamVR 和原生的连接方式
  watch(feed: PanelFeed): PanelFeed;   // 面板的页面过一遍这里：记下发给它的指点事件
}

// 推进脚本的 Vr：每个显示帧开头(取事件时)做到点的步骤；悬浮窗口显示、隐藏成了就告诉 seen
class SimVr extends FakeVr {
  private readonly frame: (vr: SimVr) => void;
  private readonly seen: (overlay: FakeOverlay, on: boolean) => void;

  constructor(frame: (vr: SimVr) => void, seen: (overlay: FakeOverlay, on: boolean) => void) {
    super();
    this.frame = frame;
    this.seen = seen;
  }

  override events(): number[] {
    this.frame(this);
    return super.events();
  }

  override show(h: Handle): boolean {
    return this.changed(h, true, super.show(h));
  }

  override hide(h: Handle): boolean {
    return this.changed(h, false, super.hide(h));
  }

  // 显示或隐藏成了：把是哪个悬浮窗口告诉 seen；返回成没成功
  private changed(h: Handle, on: boolean, ok: boolean): boolean {
    const overlay = ok ? this.overlays.findLast(o => o.handle === h) : undefined;
    if (overlay) this.seen(overlay, on);
    return ok;
  }
}

export function createSim(script: SimScript, deps: SimDeps): Sim {
  let started = false;                // 连过了(脚本只跑一遍)
  let since = 0;                      // 连上的时间(ms)
  let next = 0;                       // 下一个要做的步骤
  let finished = false;
  let device: Gpu | null = null;
  const textures = new Map<unknown, { width: number; height: number }>();      // 还没放掉的常驻纹理 → 像素
  const panels = new Map<string, { feed: PanelFeed; inputs: SimInput[] }>();   // 开过页面的面板：最近开的那一页、收到的指点事件
  const shows = new Map<string, SimPanel['shows']>();                          // 悬浮窗口的键 → 每次显示和隐藏
  const tips = new Map<Side, Mat34>();                                         // 脚本给的指尖相对手柄的变换；没给的手指尖就在手柄上

  // 一块面板没销毁的悬浮窗口；id 为 null 时是显示着的悬浮窗口里建得最早的那块面板
  const overlayOf = (vr: SimVr, id: string | null): { id: string; overlay: FakeOverlay } | null => {
    const found = (id === null ? [...panels.keys()] : [id]).flatMap(panel => {
      const overlay = vr.find(overlayKey(panel));
      return overlay && !overlay.destroyed && (id !== null || overlay.visible) ? [{ id: panel, overlay }] : [];
    });
    return found.sort((a, b) => Number(a.overlay.handle) - Number(b.overlay.handle))[0] ?? null;
  };

  // 一块面板纹理的高 / 宽：还没有纹理时用页面报的大小；都没有时为 null
  const aspect = (id: string, overlay: FakeOverlay): number | null => {
    const texture = textures.get(overlay.texture);
    const feed = panels.get(id)?.feed;
    const width = texture?.width || feed?.width || 0;
    const height = texture?.height || feed?.height || 0;
    return width && height ? height / width : null;
  };

  // 记下发给一块面板的页面的一个指点事件；连着几次一样的移动只记一次，跑完之后的不记
  const note = (inputs: SimInput[], e: PanelInput): void => {
    const last = inputs.at(-1);
    const same = e.kind === 'move' && last?.kind === 'move' && last.x === e.x && last.y === e.y && last.held === e.held;
    if (!finished && !same) inputs.push({ ...e, at: Math.round(performance.now() - since) });
  };

  const apply = (vr: SimVr, s: SimStep): void => {
    switch (s.kind) {
      case 'wheel': {
        const page = panels.get(s.panel);
        const { width = 0, height = 0 } = page?.feed ?? {};
        if (!page || !width || !height) return deps.log(`vr sim: nothing to scroll (${s.at} ms)`, 'warn');
        const e: PanelInput = { kind: 'wheel', x: Math.round(s.x * width), y: Math.round(s.y * height), dx: s.dx, dy: s.dy };
        note(page.inputs, e);
        return page.feed.input(e);
      }
      case 'head': return vr.setPose(0, s.pose);
      case 'hand': return vr.setPose(DEVICE[s.hand], s.pose);
      case 'tip':
        tips.set(s.hand, s.pose);
        return vr.setTip(DEVICE[s.hand], s.pose);
      case 'press': return vr.press(ACTIONS[s.action], SOURCE[s.hand], s.down);
      case 'move': {
        const hand = vr.poses()(DEVICE[s.hand]);
        if (!hand.valid) return deps.log(`vr sim: no hand to move (${s.at} ms)`, 'warn');
        const moved: Mat34 = [...hand.mat];
        moved[3] += s.by[0];
        moved[7] += s.by[1];
        moved[11] += s.by[2];
        return vr.setPose(DEVICE[s.hand], moved);
      }
      case 'aim': {
        const panel = overlayOf(vr, s.panel);
        const ratio = panel ? aspect(panel.id, panel.overlay) : null;
        const where = panel ? vr.where(panel.overlay) : null;
        if (!panel || ratio === null || !where) return deps.log(`vr sim: nothing to aim at (${s.at} ms)`, 'warn');
        const aimed = aimPose(where, panel.overlay.meters, ratio, s.x, s.y);
        const tip = tips.get(s.hand);
        return vr.setPose(DEVICE[s.hand], tip ? mul(aimed, invert(tip)) : aimed);
      }
    }
  };

  // 跑完：各块面板的常驻纹理读回存成 PNG，悬浮窗口的状态和指点事件写成 JSON
  const finish = (vr: SimVr): void => {
    try {
      const result: SimResult = { panels: [] };
      for (const [id, { inputs }] of panels) {
        const found = vr.find(overlayKey(id));
        const overlay = found && !found.destroyed ? found : null;
        const texture = overlay ? textures.get(overlay.texture) ?? null : null;
        let image: string | null = null;
        if (device && overlay && texture) {
          image = path.join(script.out, `${id}.png`);
          deps.save(image, encodePng(texture.width, texture.height, deps.readback(device, overlay.texture, texture.width, texture.height)));
        }
        result.panels.push({
          id, image, texture: texture ? { ...texture } : null,
          overlay: overlay ? { visible: overlay.visible, meters: overlay.meters, pose: overlay.pose, device: overlay.device } : null,
          shows: shows.get(overlayKey(id)) ?? [],
          inputs,
        });
      }
      deps.save(path.join(script.out, RESULT_FILE), JSON.stringify(result, null, 2));
      deps.log(`vr sim finished: ${script.out}`);
    } catch (e) {
      deps.log(`vr sim failed: ${errorText(e)}`, 'error');
    }
  };

  // 一个显示帧：做到点的步骤；过了结束时间就收尾。调用记录不留着
  const frame = (vr: SimVr): void => {
    vr.calls.length = 0;
    if (finished) return;
    const elapsed = performance.now() - since;
    for (let s = script.steps[next]; s && s.at <= elapsed; s = script.steps[++next]) apply(vr, s);
    if (elapsed < script.end) return;
    finished = true;
    finish(vr);
  };

  const backend: VrBackend = {
    running: () => !started,
    connect: () => {
      started = true;
      since = performance.now();
      const vr = new SimVr(frame, (overlay, on) => {
        if (finished) return;
        const list = shows.get(overlay.key) ?? [];
        shows.set(overlay.key, list);
        list.push({ at: Math.round(performance.now() - since), on });
      });
      vr.hz = script.hz;
      vr.setPose(0, HEAD);
      for (const side of SIDES) {
        vr.setRole(ROLE[side], DEVICE[side]);
        vr.setTip(DEVICE[side], IDENTITY);
      }
      vr.hit = (overlay, source, dir) => squareHit(source, dir, overlay.pose, overlay.meters);
      return vr;
    },
    // 显卡设备过一遍这里：记下各块面板的常驻纹理
    gpu: luid => {
      const inner = deps.gpu(luid);
      device = inner;
      return {
        createQuery: () => inner.createQuery(),
        createTexture: (width, height) => {
          const ptr = inner.createTexture(width, height);
          textures.set(ptr, { width, height });
          return ptr;
        },
        beginCopy: (handle, dst, query) => inner.beginCopy(handle, dst, query),
        done: query => inner.done(query),
        release: obj => {
          textures.delete(obj);
          inner.release(obj);
        },
        closeHandle: handle => inner.closeHandle(handle),
        dispose: () => {
          device = null;
          textures.clear();
          inner.dispose();
        },
      };
    },
  };

  const watch = (inner: PanelFeed): PanelFeed => {
    const inputs = panels.get(inner.id)?.inputs ?? [];
    panels.set(inner.id, { feed: inner, inputs });
    return {
      get id() { return inner.id; },
      get width() { return inner.width; },
      get height() { return inner.height; },
      get state() { return inner.state; },
      onFrame: fn => inner.onFrame(fn),
      onDrop: fn => inner.onDrop(fn),
      onSize: fn => inner.onSize(fn),
      onState: fn => inner.onState(fn),
      release: seq => inner.release(seq),
      input: e => {
        note(inputs, e);
        inner.input(e);
      },
      setPainting: on => inner.setPainting(on),
      setFrameRate: fps => inner.setFrameRate(fps),
      close: () => inner.close(),
    };
  };

  return { backend, watch };
}

// 读脚本文件，用真的显卡设备和文件系统跑；脚本读不了或格式不对时抛出异常
export function loadSim(file: string, log: (text: string, level?: LogLevel) => void): Sim {
  const full = path.resolve(file);
  const script = parseScript(JSON.parse(fs.readFileSync(full, 'utf8')) as unknown, path.dirname(full));
  log(`vr sim: ${full}`);
  return createSim(script, {
    gpu: luid => new D3D(luid),
    readback: (gpu, texture, width, height) => {
      if (!(gpu instanceof D3D)) throw new Error('读回要真的显卡设备');
      return gpu.readback(texture, width, height);
    },
    save: (target, data) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    },
    log,
  });
}
