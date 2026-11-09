// 和 SteamVR 的一次连接：探测、连接、释放，动作句柄，两只手(指尖和指针圆点)，每帧循环。
// 每帧：取事件和姿态 → 面板表照布局对一遍 → 两只手对每块显示着的面板求交 → 更新动作集(要挡游戏按键时用最高优先级) →
// 读按键 → 交互算出指令 → 执行指令 → 逐块交纹理 → 发布状态。取事件、取姿态、更新动作集、读按键出错、显卡设备丢了或 SteamVR 退出才断开。
// 头显和两只手柄这一帧的姿态也交给面板表：附着在它们上面的面板按这个算位置。附着在一只手上的面板不和这只手的射线求交。

import type { DisplayOptions, LogLevel } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import type { Gpu, Handle, Pose, Vr, VrBackend } from './api.ts';
import type { Board } from './control.ts';
import { D3D } from './d3d.ts';
import { distance, mul, ray, rayQuad, uvToPixel, type Mat34, type QuadHit, type Vec3 } from './geometry.ts';
import { blockPriority, IDLE, letGo, pickHit, reaches, step, type Command, type Frame, type HandAim, type HandIndex, type HandInput, type State } from './interact.ts';
import { EVENT_QUIT, HMD_DEVICE, MAX_DEVICES, OpenVR, ROLE_LEFT, ROLE_RIGHT, steamVrRunning } from './openvr.ts';
import { needTip, nextDotShown } from './pointer.ts';
import type { Mounts, Stage, StageShape } from './stage.ts';
import { APP_KEY } from './surface.ts';

const PROBE_MS = 5000;               // 没连上时多久查一次 SteamVR；断开后也隔这么久重连
const TICK_HZ_MIN = 30;              // 每帧循环的频率范围(Hz)，头显刷新率夹在这个范围里
const TICK_HZ_MAX = 144;
const DOT_METERS = 0.006;            // 指针圆点的直径(米)
const DOT_SORT = 10;                 // 圆点画在面板上面(面板的排序是 0)
const PRIORITY_BLOCK = 0x01ffffff;   // SteamVR 允许的最高输入优先级
const HIT_CHECK_PIXELS = 2;          // 核对求交：两种算法的落点差这么多像素以上记一行日志
const HIT_CHECK_LOG_MS = 1000;       // 核对求交的日志最多隔这么久(毫秒)记一行

// 求交的两条退路(显示方的设置)
export interface HitSettings {
  check: boolean;    // 每帧另外调一次 SteamVR 的求交，和这里算的差得多时记日志
  native: boolean;   // 整体改用 SteamVR 的求交
}

export interface SessionDeps {
  log(text: string, level?: LogLevel): void;
  stage: Stage;
  board: Board;
  hit: HitSettings;
  changed(): void;                 // 连接状态变了
  actionManifest: string;          // 动作清单(actions.json)的路径
  appManifest: string;             // SteamVR 应用清单的路径
  pointerImage: string;            // 指针圆点的贴图(png)
}

interface Hand {
  role: number;
  source: Handle;
  device: number;
  tip: Mat34 | null;                 // 手柄坐标系里的指尖
  tipAt: number;                     // 最近一次取指尖的时间(ms)
  dot: Handle;
  dotShown: boolean;                 // 圆点正显示着
}

// 一只手这一帧在哪：tip 是指尖在站立空间里的姿态(取不到时为 null)，mount 是手柄的设备序号和姿态(没有设备、姿态无效时为 null)
interface Located {
  tip: Mat34 | null;
  mount: Mounts['left'];
}

interface Actions { set: Handle; toggle: Handle; click: Handle; grab: Handle; quick1: Handle; quick2: Handle }

// 原生的连接方式：openvr_api.dll 和 D3D11
const NATIVE: VrBackend = {
  running: () => steamVrRunning(),
  connect: () => OpenVR.connect(),
  gpu: luid => new D3D(luid),
};

// SteamVR 的求交结果(命中区域是边长等于宽度的正方形，不分正反面)换成和这里算的同一种；落在面板的矩形外时为 null
function nativeHit(vr: Vr, shape: StageShape, source: Vec3, dir: Vec3): QuadHit | null {
  const hit = vr.intersect(shape.handle, source, dir);
  const px = hit ? uvToPixel(hit.u, hit.v, shape.width, shape.height) : null;
  return hit && px ? { x: px.x, y: px.y, inside: true, front: true, point: hit.point, distance: distance(source, hit.point) } : null;
}

export class Session {
  private readonly deps: SessionDeps;
  private readonly backend: VrBackend;
  private vr: Vr | null = null;
  private gpu: Gpu | null = null;
  private actions: Actions | null = null;
  private hands: Hand[] = [];
  private loop: NodeJS.Timeout | undefined;
  private probeTimer: NodeJS.Timeout | undefined;
  private last = 0;                  // 上一帧的时间(ms)
  private state: State = IDLE;       // 交互的状态
  private failure = '';              // 最近一次连接失败的错误文字，同一个错误只记一次日志
  private checkedAt = -Infinity;     // 最近一次记核对求交的日志的时间(ms)

  // backend：探测和建连接的方式，不给时用原生的
  constructor(deps: SessionDeps, backend: VrBackend = NATIVE) {
    this.deps = deps;
    this.backend = backend;
  }

  get connected(): boolean {
    return this.vr !== null;
  }

  // 开始探测和连接；已经开始了时不做
  start(): void {
    if (this.probeTimer) return;
    this.probe();
    this.probeTimer = setInterval(() => this.probe(), PROBE_MS);
  }

  stop(): void {
    clearInterval(this.probeTimer);
    this.probeTimer = undefined;
    this.disconnect();
  }

  // 没连着时查 SteamVR 在不在运行，在就连接；连接失败时放掉连到一半的资源
  private probe(): void {
    if (this.vr) return;
    this.deps.stage.expire();
    try {
      if (!this.backend.running()) {
        this.failure = '';
        return;
      }
      this.connect();
      this.failure = '';
    } catch (e) {
      this.release();
      const text = errorText(e);
      if (text !== this.failure) this.deps.log(`vr: ${text}`, 'error');
      this.failure = text;
    }
  }

  private connect(): void {
    const vr = this.backend.connect();
    this.vr = vr;
    this.gpu = this.backend.gpu(vr.outputLuid());
    try { vr.register(this.deps.appManifest, APP_KEY); } catch (e) { this.deps.log(`cannot register steamvr app: ${errorText(e)}`, 'warn'); }
    const err = vr.setManifest(this.deps.actionManifest);
    if (err !== 0) this.deps.log(`action manifest failed: ${err}`, 'error');
    this.actions = {
      set: vr.handle('set', '/actions/main'),
      toggle: vr.handle('action', '/actions/main/in/OverlayToggle'),
      click: vr.handle('action', '/actions/main/in/OverlayInteract'),
      grab: vr.handle('action', '/actions/main/in/OverlayGrab'),
      quick1: vr.handle('action', '/actions/main/in/PanelQuick1'),
      quick2: vr.handle('action', '/actions/main/in/PanelQuick2'),
    };
    this.hands = [this.hand(vr, ROLE_LEFT, 'left'), this.hand(vr, ROLE_RIGHT, 'right')];
    const hz = Math.min(TICK_HZ_MAX, Math.max(TICK_HZ_MIN, vr.refreshRate()));
    this.deps.stage.attach(vr, this.gpu);
    this.state = IDLE;
    this.last = performance.now();
    this.loop = setInterval(() => this.tick(), Math.floor(1000 / hz));
    this.deps.log('steamvr connected');
    this.deps.changed();
  }

  // 一只手：输入源句柄和它的指针圆点(贴着指针图片的悬浮窗口)
  private hand(vr: Vr, role: number, name: 'left' | 'right'): Hand {
    const dot = vr.overlay(`${APP_KEY}:pointer.${name}`, `FoxPanel pointer ${name}`);
    vr.setWidth(dot, DOT_METERS);
    vr.setSortOrder(dot, DOT_SORT);
    const err = vr.setImage(dot, this.deps.pointerImage);
    if (err !== 0) this.deps.log(`pointer texture failed: ${err}`, 'warn');
    const source = vr.handle('source', `/user/hand/${name}`);
    return { role, source, device: -1, tip: null, tipAt: 0, dot, dotShown: false };
  }

  // 放掉这次连接的全部资源(面板的页面留着停画：按着的扳机替它补抬起，指着的发移出)；本来就没连着时返回 false
  private release(): boolean {
    clearInterval(this.loop);
    const vr = this.vr;
    this.vr = null;
    if (!vr) return false;
    for (const command of letGo(this.state)) {
      if (command.kind === 'input') this.deps.stage.execute(command);
    }
    try { vr.activate(this.actions?.set ?? 0, 0); } catch { /* 已断开 */ }
    for (const h of this.hands) try { vr.destroy(h.dot); } catch { /* 已断开 */ }
    this.deps.stage.detach();
    this.gpu?.dispose();
    this.gpu = null;
    this.hands = [];
    this.actions = null;
    this.state = IDLE;
    try { vr.shutdown(); } catch { /* SteamVR 已经退出 */ }
    return true;
  }

  private disconnect(): void {
    if (!this.release()) return;
    this.deps.log('steamvr disconnected');
    this.deps.changed();
  }

  // ---------- 每个显示帧 ----------

  private tick(): void {
    const { vr, actions } = this;
    const [left, right] = this.hands;
    if (!vr || !actions || !left || !right) return;
    const { board, stage } = this.deps;
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    try {
      if (vr.events().includes(EVENT_QUIT)) return this.disconnect();
      const pose = vr.poses();
      const head = pose(HMD_DEVICE);
      const hands = [this.locate(vr, left, pose, now), this.locate(vr, right, pose, now)] as const;
      const mounts: Mounts = { head: head.valid ? { device: HMD_DEVICE, pose: head.mat } : null, left: hands[0].mount, right: hands[1].mount };
      const shapes = stage.reconcile(head.mat, mounts);
      const aims = [this.aim(vr, 0, hands[0].tip, shapes, now), this.aim(vr, 1, hands[1].tip, shapes, now)] as const;
      vr.activate(actions.set, board.settings.options.blockInput && blockPriority(this.state, aims) ? PRIORITY_BLOCK : 0);
      const { state, commands } = step(this.state, this.read(vr, actions, shapes, [left, right], aims, board.settings.options), dt);
      this.state = state;
      for (const command of commands) this.run(vr, command);
      stage.submit();
      board.flush();
    } catch (e) {
      this.deps.log(`vr: ${errorText(e)}`, 'error');
      this.disconnect();
    }
  }

  // 一只手这一帧在站立空间里的姿态：手柄的和指尖的；没有设备、姿态无效时都为 null，取不到指尖时指尖为 null
  private locate(vr: Vr, h: Hand, pose: (i: number) => Pose, now: number): Located {
    const device = vr.roleIndex(h.role);
    const valid = device >= 1 && device < MAX_DEVICES;
    if (needTip(h.device, device, valid, h.tip !== null, now, h.tipAt)) {
      h.device = device;
      h.tip = valid ? vr.tip(device, h.source) : null;
      h.tipAt = now;
    }
    const p = valid ? pose(device) : null;
    const mount = p?.valid ? { device, pose: p.mat } : null;
    return { tip: mount && h.tip ? mul(mount.pose, h.tip) : null, mount };
  }

  // 一只手的指尖的射线对每块显示着的面板求交；附着在这只手上的面板不算。
  // 附着在头显或手上的面板一律用这里算出的姿态求交，不问 SteamVR
  private aim(vr: Vr, hand: HandIndex, tip: Mat34 | null, shapes: readonly StageShape[], now: number): HandAim {
    if (!tip) return { tip, hits: shapes.map(() => null) };
    const { source, dir } = ray(tip);
    const { check, native } = this.deps.hit;
    const hits = shapes.map(s => {
      if (!reaches(hand, s)) return null;
      return native && s.anchor === 'world' ? nativeHit(vr, s, source, dir) : rayQuad(source, dir, s.pose, s.meters, s.width, s.height);
    });
    const aim: HandAim = { tip, hits };
    if (check && !native) this.check(vr, shapes, aim, source, dir, now);
    return aim;
  }

  // 核对求交：这只手指着的那块面板(留在空间里的)另外调一次 SteamVR 的求交，落点差 HIT_CHECK_PIXELS 以上记一行日志
  private check(vr: Vr, shapes: readonly StageShape[], aim: HandAim, source: Vec3, dir: Vec3, now: number): void {
    const index = pickHit(aim);
    const shape = shapes[index];
    const mine = aim.hits[index];
    if (!shape || !mine || shape.anchor !== 'world' || now - this.checkedAt < HIT_CHECK_LOG_MS) return;
    const theirs = nativeHit(vr, shape, source, dir);
    if (theirs && Math.abs(theirs.x - mine.x) < HIT_CHECK_PIXELS && Math.abs(theirs.y - mine.y) < HIT_CHECK_PIXELS) return;
    this.checkedAt = now;
    this.deps.log(`hit check ${shape.id}: js ${mine.x},${mine.y} native ${theirs ? `${theirs.x},${theirs.y}` : 'none'}`, 'warn');
  }

  // 读两只手的按键，拼成这一帧的输入
  private read(vr: Vr, a: Actions, shapes: readonly StageShape[], hands: readonly [Hand, Hand], aims: readonly [HandAim, HandAim], options: DisplayOptions): Frame {
    let toggle = false;
    let quick1 = false;
    let quick2 = false;
    const pressed = (action: Handle, source: Handle): boolean => {
      const b = vr.button(action, source);
      return b.changed && b.down;
    };
    const input = (i: HandIndex): HandInput => {
      const { source } = hands[i];
      if (pressed(a.toggle, source)) toggle = true;
      const click = vr.button(a.click, source);
      const grab = vr.button(a.grab, source);
      if (pressed(a.quick1, source)) quick1 = true;
      if (pressed(a.quick2, source)) quick2 = true;
      return { ...aims[i], click, grab };
    };
    const both: [HandInput, HandInput] = [input(0), input(1)];
    return { panels: shapes, hands: both, options, toggle, quick1, quick2 };
  }

  // 执行一条指令：圆点自己放，开关面板交给布局，其余的交给面板表
  private run(vr: Vr, command: Command): void {
    switch (command.kind) {
      case 'dot': {
        const hand = this.hands[command.hand];
        if (!hand) return;
        const { pose } = command;
        if (pose) vr.place(hand.dot, pose);
        hand.dotShown = nextDotShown(hand.dotShown, pose !== null, want => (want ? vr.show(hand.dot) : vr.hide(hand.dot)));
        return;
      }
      case 'toggleAll':
      case 'quick':
        return this.deps.board.run(command);
      default:
        return this.deps.stage.execute(command);
    }
  }
}
