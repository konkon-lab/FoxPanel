// 面板表：开过页面的面板各一条(页面的把手、悬浮窗口、出过的错)，比 SteamVR 的连接活得久——断开时只放掉悬浮窗口和纹理，
// 页面留着停画，再连上时该显示的面板重新建悬浮窗口。每帧照布局对一遍：建或销毁悬浮窗口(一帧最多一个)、显示和隐藏、宽度、位置；
// 执行交互算出的指令；逐块把纹理交给 SteamVR。一块面板出错只动它自己，显卡设备丢了才往外抛(由会话断开重连)。
// 附着在头显或手上的面板：布局里记的是相对那个设备的变换(没摆过的用那个设备的默认位置，不记进布局)，
// 每帧接上设备的姿态算出面板空间里的姿态(求交、圆点用)；被抓着挪的那几帧以上一帧给它的面板空间里的姿态为准，设备动了不带着它走；
// 设备不在、抬手才显示的没朝向眼睛时悬浮窗口隐藏着待命(页面照常画)，这块面板不在这一帧显示着的面板里。

import type { LogLevel, PanelAnchor, PanelFeed, PanelInfo } from '@konkon-lab/foxpanel-sdk';
import {
  anchorOf, glances, grabDelayOf, isOpen, metersOf, movable, PAGE_LINGER_MS, place, recordOf, setOpen, setPanel, shownSet, type Pose,
} from '../../_shared/panels/layout.ts';
import { errorText } from '../../_shared/util.ts';
import { GpuLost, type Gpu, type Handle, type Vr } from './api.ts';
import type { Board } from './control.ts';
import { anchorDefault, anchorPose, arrange, glanceShown, needsArrange, position, relativeTo, type Mat34, type Vec3 } from './geometry.ts';
import type { Command, PanelShape } from './interact.ts';
import { overlayKey, Surface } from './surface.ts';

const FAULT_WINDOW_MS = 10_000;   // 一块面板在这么长时间(毫秒)里
const FAULT_LIMIT = 3;            // 出错这么多次就停用
const FAULT_REST_MS = 1000;       // 一块面板出错后歇这么久(毫秒)才重试：这期间不开它的页面、不动它的悬浮窗口、不交它的纹理
const OVERLAYS_PER_FRAME = 1;     // 一帧里最多建或销毁这么多个悬浮窗口

// 交互的指令里对着一块面板的那些
export type PanelCommand = Extract<Command, { id: string }>;

// 面板能附着的设备
type Mount = Exclude<PanelAnchor, 'world'>;

// 能附着的设备这一帧的情况：设备序号和它在面板空间里的姿态；设备不在、姿态无效时为 null
export type Mounts = Readonly<Record<Mount, { device: number; pose: Mat34 } | null>>;

// 一个设备都不在
const NO_MOUNTS: Mounts = { head: null, left: null, right: null };

// 这一帧显示着的一块面板：交互用的形状，加求交用的悬浮窗口句柄和纹理像素
export interface StageShape extends PanelShape {
  handle: Handle;
  width: number;
  height: number;
}

export interface StageDeps {
  board: Board;
  open(id: string): PanelFeed;                    // 开一块面板的页面(离屏、交帧)
  log(text: string, level?: LogLevel): void;
  everyFrame: boolean;                            // 纹理每个显示帧都交给 SteamVR；为假时只在画面变了、悬浮窗口刚显示出来时交
  native: boolean;                                // 附着的面板交给 SteamVR 带着设备走；为假时每帧把算出的姿态设成绝对位置
}

interface Slot {
  id: string;
  feed: PanelFeed | null;          // 开着的页面
  painting: boolean;               // 页面在画
  surface: Surface | null;         // 悬浮窗口；没连着、还没轮到建时为 null
  visible: boolean;                // 悬浮窗口显示着
  hiddenAt: number;                // 从什么时候起不显示(ms)
  placed: Pose | null | undefined; // 布局里已经用到悬浮窗口上的那份位置；undefined = 这个悬浮窗口还没放过
  sized: number;                   // 布局里已经用到悬浮窗口上的宽度(米)
  anchor: PanelAnchor;             // 布局里已经用到悬浮窗口上的附着对象
  relative: Mat34 | null;          // 附着的面板这一刻相对设备的变换(抓着挪时和布局里记的不一样)；留在空间里的、还没算过时为 null
  carried: Mat34 | null;           // 附着的面板被抓着挪：上一帧给它的面板空间里的姿态；没被抓着时为 null
  standby: boolean;                // 附着的面板该显示着：悬浮窗口待命，设备不在、没抬手时隐藏，页面照常画
  raised: boolean;                 // 抬手才显示最近一次算出的结果(设备不在、头显姿态无效的那几帧不动它)；不用抬手的面板为真
  away: boolean;                   // 该显示而这一刻没在显示(设备不在、没抬手)
  faults: number[];                // 最近几次出错的时间(ms)
  restUntil: number;               // 出错后歇到什么时候(ms)
}

export class Stage {
  private readonly deps: StageDeps;
  private readonly slots = new Map<string, Slot>();
  private vr: Vr | null = null;
  private gpu: Gpu | null = null;
  private mounts: Mounts = NO_MOUNTS;   // 最近一帧各个设备的情况

  constructor(deps: StageDeps) {
    this.deps = deps;
  }

  // 连上了：之后每帧照布局建悬浮窗口
  attach(vr: Vr, gpu: Gpu): void {
    this.vr = vr;
    this.gpu = gpu;
  }

  // 断开了：悬浮窗口和纹理都放掉，页面留着停画；抬手才显示的结果不留
  detach(): void {
    const now = performance.now();
    for (const slot of this.slots.values()) {
      slot.surface?.dispose();
      slot.surface = null;
      slot.placed = undefined;
      slot.relative = null;
      if (slot.visible || slot.standby) slot.hiddenAt = now;
      slot.visible = false;
      slot.standby = false;
      slot.raised = false;
      slot.away = false;
      this.paint(slot, false);
    }
    this.vr = null;
    this.gpu = null;
    this.mounts = NO_MOUNTS;
  }

  // 全部收掉：悬浮窗口放掉，页面关掉(这个显示方不生效了，页面归生效的那个开)
  clear(): void {
    for (const slot of [...this.slots.values()]) this.retire(slot);
  }

  // 页面画不画；已经是这样时不说
  private paint(slot: Slot, on: boolean): void {
    if (!slot.feed || slot.painting === on) return;
    slot.painting = on;
    slot.feed.setPainting(on);
  }

  // 加一条：还没有页面和悬浮窗口
  private add(id: string, now: number): Slot {
    const slot: Slot = {
      id, feed: null, painting: false, surface: null, visible: false, hiddenAt: now, placed: undefined, sized: 0,
      anchor: 'world', relative: null, carried: null, standby: false, raised: false, away: false, faults: [], restUntil: 0,
    };
    this.slots.set(id, slot);
    return slot;
  }

  // 拿掉一条：放掉悬浮窗口，关掉页面
  private retire(slot: Slot): void {
    this.slots.delete(slot.id);
    slot.surface?.dispose();
    slot.surface = null;
    slot.feed?.close();
    slot.feed = null;
  }

  // 一块面板出了一次错：记一行警告，歇 FAULT_REST_MS 再重试；FAULT_WINDOW_MS 里满 FAULT_LIMIT 次就停用——
  // 放掉悬浮窗口、关掉页面、布局里算关着并带上原因。显卡设备丢了不算在这块面板头上，原样往外抛
  private fault(slot: Slot, e: unknown): void {
    if (e instanceof GpuLost) throw e;
    const reason = errorText(e);
    this.deps.log(`panel ${slot.id}: ${reason}`, 'warn');
    const now = performance.now();
    slot.faults = [...slot.faults.filter(t => now - t < FAULT_WINDOW_MS), now];
    slot.restUntil = now + FAULT_REST_MS;
    if (slot.faults.length < FAULT_LIMIT || this.slots.get(slot.id) !== slot) return;
    this.retire(slot);
    this.deps.board.fail(slot.id, reason);
  }

  // 开这块面板的页面：停着画，等悬浮窗口显示出来再画。页面出错算这块面板的一次错(关掉它，歇过以后重新开)；
  // 页面没了(被别的显示方接走、面板不在目录里了)：摘掉页面，这块面板算关着，悬浮窗口留给每帧的对账按名额销毁
  private open(slot: Slot): void {
    const feed = this.deps.open(slot.id);
    slot.feed = feed;
    slot.painting = true;
    this.paint(slot, false);
    slot.surface?.attach(feed);
    feed.onState((state, detail) => {
      if (slot.feed !== feed || (state !== 'failed' && state !== 'gone')) return;
      slot.surface?.attach(null);
      slot.feed = null;
      feed.close();
      if (state === 'failed') this.fault(slot, detail ?? 'panel page failed');
      else this.deps.board.change(layout => setOpen(layout, this.deps.board.settings, slot.id, false));
    });
  }

  // 没连着时：页面没了的、不显示满 PAGE_LINGER_MS 且清单没写 keep 的面板，拿掉
  expire(): void {
    const now = performance.now();
    for (const slot of [...this.slots.values()]) {
      const keep = this.deps.board.list.find(p => p.id === slot.id)?.keep === true;
      if (!slot.visible && (!slot.feed || (!keep && now - slot.hiddenAt >= PAGE_LINGER_MS))) this.retire(slot);
    }
  }

  // 每帧照布局对一遍，返回这一帧显示着的面板。head 是这一帧取到的头显矩阵：没摆过的、显示时该拉回面前的面板按它放；
  // mounts 是能附着的设备这一帧的情况(抬手才显示按里面头显的姿态判断)
  reconcile(head: Mat34, mounts: Mounts): StageShape[] {
    const { vr, gpu } = this;
    if (!vr || !gpu) return [];
    this.mounts = mounts;
    const { board } = this.deps;
    const now = performance.now();
    const list = board.list;
    const shown = new Set(shownSet(board.layout, board.settings));
    let budget = OVERLAYS_PER_FRAME;
    // 这一帧还能不能动 slot 的悬浮窗口(建或销毁)：它没有悬浮窗口时不占名额
    const spend = (slot: Slot): boolean => {
      if (!slot.surface) return true;
      if (budget <= 0) return false;
      budget--;
      return true;
    };
    for (const slot of [...this.slots.values()]) {
      if (!list.some(p => p.id === slot.id) && spend(slot)) this.retire(slot);
    }
    const shapes: StageShape[] = [];
    for (const info of list) {
      let slot = this.slots.get(info.id);
      try {
        if (!shown.has(info.id)) {
          // 清单写了 keep、打开着的面板(被总开关收起着、排在上限之后)：页面开着停画，显示时不用等它加载
          const warm = info.keep && isOpen(board.layout, info.id);
          if (!slot) {
            if (!warm) continue;
            slot = this.add(info.id, now);
          }
          if (slot.visible || slot.standby) {
            slot.surface?.setStandby(false);
            slot.surface?.setShown(false);
            if (slot.surface?.visible) continue;
            slot.visible = false;
            slot.standby = false;
            slot.raised = false;
            slot.away = false;
            slot.hiddenAt = now;
            this.paint(slot, false);
          } else if (warm) {
            if (!slot.feed && now >= slot.restUntil) this.open(slot);
          } else if ((!slot.feed || (!info.keep && now - slot.hiddenAt >= PAGE_LINGER_MS)) && spend(slot)) this.retire(slot);
          continue;
        }
        slot ??= this.add(info.id, now);
        const anchor = anchorOf(board.layout, info.id);
        if (anchor !== slot.anchor) {
          slot.anchor = anchor;
          slot.placed = undefined;
          slot.relative = null;
          slot.raised = false;
        }
        const riding = anchor === 'world' ? null : this.ride(slot, anchor);
        slot.away = anchor !== 'world' && !riding;
        if (now < slot.restUntil) continue;
        if (!slot.feed) this.open(slot);
        if (!slot.surface) {
          if (budget <= 0) continue;
          budget--;
          slot.sized = metersOf(board.layout, info);
          slot.surface = new Surface(vr, gpu, {
            key: overlayKey(info.id), name: `FoxPanel ${info.id}`, meters: slot.sized, everyFrame: this.deps.everyFrame,
          }, slot.feed, text => this.deps.log(`vr: ${info.id} ${text}`));
        }
        const shape = anchor === 'world' ? this.show(slot, slot.surface, info, head, list, shown) : this.showOn(slot, slot.surface, info, anchor, riding);
        if (shape) shapes.push(shape);
      } catch (e) {
        if (!slot) throw e;
        this.fault(slot, e);
      }
    }
    board.conceal([...this.slots.values()].filter(slot => slot.away && shown.has(slot.id)).map(slot => slot.id));
    return shapes;
  }

  // 附着的面板这一帧在面板空间里的姿态：设备的姿态接上相对它的变换。布局里没记相对变换时用那个设备的默认位置(不记进布局)；
  // 没显示着时、布局里记的变了时相对变换照布局里记的。被抓着挪时是上一帧给它的那份姿态(设备动了不带着它走，
  // 相对变换等这一帧的指令给)。
  // 设备不在、抬手才显示的正面没朝向眼睛时为 null；抬手才显示在头显姿态无效时照最近一次的结果
  private ride(slot: Slot, anchor: Mount): Mat34 | null {
    const { board } = this.deps;
    const recorded = recordOf(board.layout, slot.id)?.pose ?? null;
    if (!slot.relative || !slot.visible || recorded !== slot.placed) {
      slot.placed = recorded;
      slot.relative = recorded ?? anchorDefault(anchor);
      slot.carried = null;
    }
    const mount = this.mounts[anchor];
    const carried = slot.carried;
    slot.carried = null;
    if (!mount) return null;
    const world = carried ?? anchorPose(mount.pose, slot.relative);
    const eye = this.mounts.head?.pose;
    slot.raised = !glances(board.layout, slot.id) || (eye ? glanceShown(eye, world, slot.raised) : slot.raised);
    return slot.raised ? world : null;
  }

  // 一块面板这一帧的形状
  private shape(surface: Surface, info: PanelInfo, anchor: PanelAnchor): StageShape | null {
    const { board } = this.deps;
    const { width, height } = surface.size;
    if (!surface.pose) return null;
    return {
      id: info.id, pose: surface.pose, meters: surface.meters, minMeters: info.minMeters, maxMeters: info.maxMeters,
      aspect: width > 0 ? height / width : 0, movable: movable(board.layout, info.id), anchor,
      grabDelay: grabDelayOf(board.layout, board.settings.options, info.id), handle: surface.handle, width, height,
    };
  }

  // 一块该显示的附着的面板：宽度跟上布局(没显示着时也照布局的宽度，缩放到一半被隐藏的不留着半截的宽度)，
  // 悬浮窗口待命、页面画着；world 是它这一帧在面板空间里的姿态，
  // 为 null(设备不在、没抬手)时隐藏，否则跟上设备并显示出来。返回它这一帧的形状，没在显示时为 null
  private showOn(slot: Slot, surface: Surface, info: PanelInfo, anchor: Mount, world: Mat34 | null): StageShape | null {
    const meters = metersOf(this.deps.board.layout, info);
    if (meters !== slot.sized || !slot.visible) {
      surface.setMeters(meters);
      slot.sized = meters;
    }
    surface.setStandby(true);
    slot.standby = true;
    this.paint(slot, true);
    const mount = this.mounts[anchor];
    if (!world || !mount || !slot.relative) {
      if (!slot.visible) return null;
      surface.setShown(false);
      slot.visible = surface.visible;
      return null;
    }
    surface.setRiding(mount.device, slot.relative, world, this.deps.native);
    if (!slot.visible) {
      surface.setShown(true);
      if (!surface.visible) throw new Error('overlay did not show');
      slot.visible = true;
    }
    return this.shape(surface, info, anchor);
  }

  // 一块该显示的留在空间里的面板：宽度和位置跟上布局，没显示的显示出来并让页面画。返回它这一帧的形状
  private show(slot: Slot, surface: Surface, info: PanelInfo, head: Mat34, list: readonly PanelInfo[], shown: ReadonlySet<string>): StageShape | null {
    const { board } = this.deps;
    surface.setStandby(false);
    slot.standby = false;
    const meters = metersOf(board.layout, info);
    if (meters !== slot.sized || !slot.visible) {
      surface.setMeters(meters);
      slot.sized = meters;
    }
    let pose = recordOf(board.layout, info.id)?.pose ?? null;
    if (pose !== slot.placed || !slot.visible) {
      if (slot.visible ? pose === null : needsArrange(board.settings.options.recenter, pose, head)) {
        const others: Vec3[] = [];
        for (const p of list) {
          const other = p.id !== info.id && shown.has(p.id) && anchorOf(board.layout, p.id) === 'world' ? recordOf(board.layout, p.id)?.pose : null;
          if (other) others.push(position(other));
        }
        const arranged = arrange(head, info.spawn, others);
        board.change(layout => place(layout, info.id, arranged));
        pose = recordOf(board.layout, info.id)?.pose ?? arranged;
      }
      if (pose) surface.setPose(pose);
      slot.placed = pose;
    }
    if (!slot.visible) {
      surface.setShown(true);
      if (!surface.visible) throw new Error('overlay did not show');
      slot.visible = true;
    }
    this.paint(slot, true);
    return this.shape(surface, info, 'world');
  }

  // 抓着的面板挪到面板空间里的 pose：附着的面板换算成相对设备的变换，设备不在时不动。
  // held = 还抓着：附着的面板记下这份姿态，下一帧以它为准
  private move(slot: Slot, pose: Mat34, held: boolean): void {
    if (slot.anchor === 'world') return void slot.surface?.setPose(pose);
    const mount = this.mounts[slot.anchor];
    slot.carried = held && mount ? pose : null;
    if (!mount) return;
    slot.relative = relativeTo(pose, mount.pose);
    slot.surface?.setRiding(mount.device, slot.relative, pose, this.deps.native);
  }

  // 执行交互算出的一条指令
  execute(command: PanelCommand): void {
    const slot = this.slots.get(command.id);
    if (!slot) return;
    const { board } = this.deps;
    try {
      switch (command.kind) {
        case 'input':
          slot.feed?.input(command.event);
          break;
        case 'pose':
          this.move(slot, command.pose, true);
          break;
        case 'meters':
          slot.surface?.setMeters(command.meters);
          break;
        case 'drop': {
          this.move(slot, command.pose, false);
          const kept = slot.anchor === 'world' ? command.pose : slot.relative;
          if (kept) board.change(layout => place(layout, command.id, kept));
          slot.placed = recordOf(board.layout, command.id)?.pose ?? null;
          break;
        }
        case 'resize': {
          board.change(layout => setPanel(layout, board.list, command.id, { meters: command.meters }));
          const info = board.list.find(p => p.id === command.id);
          if (!info) break;
          slot.sized = metersOf(board.layout, info);
          slot.surface?.setMeters(slot.sized);
          break;
        }
      }
    } catch (e) {
      this.fault(slot, e);
    }
  }

  // 逐块把纹理交给 SteamVR；出错后还在歇着的不交
  submit(): void {
    const now = performance.now();
    for (const slot of [...this.slots.values()]) {
      if (now < slot.restUntil) continue;
      try {
        slot.surface?.submit();
      } catch (e) {
        this.fault(slot, e);
      }
    }
  }
}
