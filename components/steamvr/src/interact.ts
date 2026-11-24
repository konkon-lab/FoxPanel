// 手柄和面板的交互：每一帧拿这一帧的输入(两只手的指尖、对每块显示着的面板的求交、扳机、握把，加开关键)和上一帧留下的状态，
// 算出新的状态和要做的事(发给页面的指点事件、圆点放哪、面板的姿态和宽度、松手后记进布局的位置和宽度、开关面板)。全是纯函数。

import type { DisplayOptions, PanelAnchor, PanelInput } from '@konkon-lab/foxpanel-sdk';
import type { Button } from './api.ts';
import {
  anchorPose, approach, clampToQuad, distance, dotPose, nearestHit, position, relativeTo, rigid, settlePose, type Mat34, type QuadHit,
} from './geometry.ts';

const FOLLOW_TAU = 0.04;             // 抓着的面板跟手的平滑时间常数(秒)
const STRETCH_MIN_DISTANCE = 0.05;   // 缩放时两手距离的下限(米)：比它近的都按它算，免得拿接近 0 的数当除数
const METERS_GRAIN = 100;            // 缩放结束时宽度取整到厘米：一米分成这么多格

// 哪只手：0 左手，1 右手
export type HandIndex = 0 | 1;
const HANDS: readonly HandIndex[] = [0, 1];
const otherHand = (h: HandIndex): HandIndex => (h === 0 ? 1 : 0);

// 这一帧显示着的一块面板
export interface PanelShape {
  id: string;
  pose: Mat34;          // 在面板空间里的姿态
  meters: number;       // 这一刻的宽度(米)
  minMeters: number;    // 能缩放到的宽度范围(米)
  maxMeters: number;
  aspect: number;       // 高 / 宽
  movable: boolean;     // 能抓、能缩放(全局锁和它自己的锁都没锁)
  anchor: PanelAnchor;  // 附着在哪；附着在一只手上的面板不吃这只手的射线，松手时不吸正
  grabDelay: number;    // 抓取延迟(秒)：握把按住这么久它才跟手
}

// 哪只手够得着这块面板：附着在一只手上的面板，这只手的射线不算打在它上面
export const reaches = (hand: HandIndex, panel: Pick<PanelShape, 'anchor'>): boolean => panel.anchor !== (hand === 0 ? 'left' : 'right');

// 一只手这一帧指着哪：tip 是指尖在面板空间里的姿态(没有设备或姿态无效时为 null)，hits 是和 panels 一一对应的求交结果
export interface HandAim {
  tip: Mat34 | null;
  hits: readonly (QuadHit | null)[];
}

// 一只手这一帧的输入
export interface HandInput extends HandAim {
  click: Button;        // 扳机
  grab: Button;         // 握把
}

export interface Frame {
  panels: readonly PanelShape[];                                    // 显示着的面板，按面板目录的顺序
  hands: readonly [HandInput, HandInput];
  options: Pick<DisplayOptions, 'stretch' | 'snap'>;
  toggle: boolean;      // 这一帧按下了总开关键
  quick1: boolean;      // 这一帧按下了 1 号、2 号快捷位键
  quick2: boolean;
}

// 面板上的一点(像素，原点在左上角)
export interface Point {
  x: number;
  y: number;
}

// 握把按在一块面板上：held 是按了多久(秒)，grip 是抓起来时面板相对指尖的位置(没满抓取延迟时为 null)
export interface Grab {
  id: string;
  held: number;
  grip: Mat34 | null;
}

export interface HandState {
  over: string | null;    // 指着的面板
  at: Point | null;       // 在那块面板上最近的落点
  press: string | null;   // 扳机按在哪块面板上；按住期间这只手锁在它上面
  grab: Grab | null;
}

export interface State {
  hands: readonly [HandState, HandState];
  drivers: Readonly<Record<string, HandIndex>>;                // 面板 id → 它听哪只手
  stretch: { id: string; d0: number; w0: number } | null;      // 双手缩放的起点：两手距离和面板宽度(米)
}

const IDLE_HAND: HandState = { over: null, at: null, press: null, grab: null };

// 什么都没指着、没按着
export const IDLE: State = { hands: [IDLE_HAND, IDLE_HAND], drivers: {}, stretch: null };

export type Command =
  | { kind: 'input'; id: string; event: PanelInput }        // 指点事件发给一块面板的页面
  | { kind: 'dot'; hand: HandIndex; pose: Mat34 | null }    // 一只手的圆点放在哪；null = 不显示
  | { kind: 'pose'; id: string; pose: Mat34 }               // 抓着的面板这一帧的姿态
  | { kind: 'meters'; id: string; meters: number }          // 缩放中的面板这一帧的宽度
  | { kind: 'drop'; id: string; pose: Mat34 }               // 松手：面板留在这(面板空间里的姿态)，记进布局
  | { kind: 'resize'; id: string; meters: number }          // 缩放结束：宽度(取整到厘米)记进布局
  | { kind: 'toggleAll' }                                   // 总开关键
  | { kind: 'quick'; slot: 1 | 2 };                         // 快捷位键

// 一只手指着哪块面板：从正面打在面板里的那些里最近的一块在 panels 里的下标；没有指尖、没打中时为 -1
export const pickHit = (hand: HandAim): number => (hand.tip ? nearestHit(hand.hits) : -1);

// 一块面板这一刻听哪只手：先指上来的那只，或最近在它上面按过扳机的那只；没有手指着它时为 null
export function driver(state: State, id: string): HandIndex | null {
  return Object.hasOwn(state.drivers, id) ? state.drivers[id] ?? null : null;
}

// 要不要挡住游戏的手柄按键：有手指着一块面板的正面、有扳机按在面板上还没松开、有手抓着面板(射线移开了也算)
export function blockPriority(state: State, hands: readonly HandAim[]): boolean {
  return hands.some(hand => pickHit(hand) >= 0) || state.hands.some(h => h.press !== null || h.grab?.grip != null);
}

type Pointing = Pick<HandState, 'over' | 'at' | 'press'>;

// 指和点：每只手指着哪块面板、圆点放哪、发给页面的移动、按下、抬起、移出。
// 扳机按住期间这只手锁在按下的那块面板上，射线滑出边缘时落点夹在边上继续发移动；
// 一块面板只听一只手，另一只手在它上面按下扳机时换手(前一只还按着的替它补抬起)；
// 面板不显示了(收起、关掉、出错)，按在它上面的扳机补抬起、指着它的手发移出
export function pointerEvents(state: State, frame: Frame): { hands: [Pointing, Pointing]; drivers: Record<string, HandIndex>; commands: Command[] } {
  const commands: Command[] = [];
  const drivers = new Map<string, HandIndex>(Object.entries(state.drivers));
  const next: [Pointing, Pointing] = [state.hands[0], state.hands[1]];
  const send = (id: string, event: PanelInput): void => { commands.push({ kind: 'input', id, event }); };
  for (const h of HANDS) {
    const hand = frame.hands[h];
    const { over, at } = next[h];
    let press = next[h].press;
    if (press !== null && !frame.panels.some(p => p.id === press)) {
      if (at) send(press, { kind: 'up', x: at.x, y: at.y });
      press = null;
    }
    const index = press === null ? pickHit(hand) : frame.panels.findIndex(p => p.id === press);
    const shape = frame.panels[index];
    const hit = shape ? hand.hits[index] ?? null : null;
    const spot: Point | null = hit ? { x: hit.x, y: hit.y } : shape ? at : null;
    const target = shape && spot ? shape.id : null;
    if (over !== null && over !== target && drivers.get(over) === h) {
      send(over, { kind: 'leave' });
      drivers.delete(over);
    }
    let dot: Mat34 | null = null;
    if (shape && spot && target !== null) {
      const pressed = press === null && hand.click.changed && hand.click.down;
      if (!drivers.has(target)) drivers.set(target, h);
      if (pressed && drivers.get(target) !== h) {
        const o = otherHand(h);
        const held = next[o];
        if (held.press === target) {
          if (held.at) send(target, { kind: 'up', x: held.at.x, y: held.at.y });
          next[o] = { ...held, press: null };
        }
        drivers.set(target, h);
      }
      if (drivers.get(target) === h) {
        send(target, { kind: 'move', x: spot.x, y: spot.y, held: press === target });
        if (pressed) {
          press = target;
          send(target, { kind: 'down', x: spot.x, y: spot.y });
        }
      }
      if (hit?.front) dot = dotPose(shape.pose, hit.inside ? hit.point : clampToQuad(hit.point, shape.pose, shape.meters, shape.aspect));
    }
    commands.push({ kind: 'dot', hand: h, pose: dot });
    if (press !== null && !hand.click.down) {
      if (spot) send(press, { kind: 'up', x: spot.x, y: spot.y });
      press = null;
    }
    next[h] = { over: target, at: target === null ? null : spot, press };
  }
  return { hands: next, drivers: Object.fromEntries(drivers), commands };
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// 抓和缩放：握把按在一块能动的面板上满它的抓取延迟后面板跟手(抓起来以后射线移开也不脱手)，松开时留在原地
// (留在空间里的面板要吸正的吸正，附着的不吸正)；
// 两只手抓着同一块时按两手距离缩放，任一只手松开就结束，宽度取整到厘米，还抓着的手重新记相对位置；
// 附着在一只手上的面板被另一只手抓着时，这只手的握把按住满抓取延迟也算抓着它(不用指着：它的射线够不着自己手上的面板)，
// 用来双手缩放；没按满就松开、另一只手放开了都不算；
// 面板不显示了就放开，不记位置
export function planGrab(state: State, frame: Frame, dt: number): { grabs: [Grab | null, Grab | null]; stretch: State['stretch']; commands: Command[] } {
  const commands: Command[] = [];
  const shapeOf = (id: string): PanelShape | undefined => frame.panels.find(p => p.id === id);
  const grabs: [Grab | null, Grab | null] = [state.hands[0].grab, state.hands[1].grab];
  const released = new Set<string>();   // 这一帧有手松开了的面板
  // 一只手够不着的面板(附着在它上面)正被另一只手抓着、双手缩放开着：这只手的握把不用指着也算按在它上面
  const joins = (h: HandIndex, shape: PanelShape): boolean => {
    const other = grabs[otherHand(h)];
    return frame.options.stretch && !reaches(h, shape) && other?.grip != null && other.id === shape.id;
  };
  for (const h of HANDS) {
    const hand = frame.hands[h];
    const aimed = frame.panels[pickHit(hand)];
    let grab = grabs[h];
    if (grab) {
      const shape = shapeOf(grab.id);
      if (!shape) grab = null;
      else if (!hand.grab.down || !shape.movable) {
        if (grab.grip) released.add(grab.id);
        grab = null;
      } else if (!grab.grip) {
        const held = grab.held + dt;
        if (aimed?.id !== grab.id && !joins(h, shape)) grab = null;
        else grab = { id: grab.id, held, grip: held >= shape.grabDelay && hand.tip ? relativeTo(shape.pose, hand.tip) : null };
      }
    } else if (hand.grab.changed && hand.grab.down) {
      const other = grabs[otherHand(h)];
      const theirs = other ? shapeOf(other.id) : undefined;   // 另一只手的握把按着的面板
      const target = aimed?.movable && (frame.options.stretch || other?.id !== aimed.id) ? aimed : theirs?.movable && joins(h, theirs) ? theirs : undefined;
      if (target) grab = { id: target.id, held: 0, grip: target.grabDelay === 0 && hand.tip ? relativeTo(target.pose, hand.tip) : null };
    }
    grabs[h] = grab;
  }

  const [left, right] = grabs;
  const both = frame.options.stretch && left?.grip && right?.grip && left.id === right.id ? shapeOf(left.id) : undefined;
  let stretch = state.stretch;
  if (stretch && stretch.id !== both?.id) {
    const shape = shapeOf(stretch.id);
    if (shape) {
      const rounded = Math.round(shape.meters * METERS_GRAIN) / METERS_GRAIN;
      commands.push({ kind: 'resize', id: shape.id, meters: clamp(rounded, shape.minMeters, shape.maxMeters) });
      for (const h of HANDS) {
        const grab = grabs[h];
        const tip = frame.hands[h].tip;
        if (grab?.grip && grab.id === shape.id && tip) grabs[h] = { ...grab, grip: relativeTo(shape.pose, tip) };
      }
    }
    stretch = null;
  }
  const [a, b] = [frame.hands[0].tip, frame.hands[1].tip];
  if (both && a && b) {
    const d = Math.max(STRETCH_MIN_DISTANCE, distance(position(a), position(b)));
    stretch ??= { id: both.id, d0: d, w0: both.meters };
    commands.push({ kind: 'meters', id: both.id, meters: clamp(stretch.w0 * d / stretch.d0, both.minMeters, both.maxMeters) });
  }

  const led = new Set<string>();   // 已经有手带着走的面板：一块面板跟着抓着它的第一只手
  for (const h of HANDS) {
    const grab = grabs[h];
    if (!grab?.grip || led.has(grab.id)) continue;
    led.add(grab.id);
    const shape = shapeOf(grab.id);
    const tip = frame.hands[h].tip;
    if (shape && tip) commands.push({ kind: 'pose', id: grab.id, pose: approach(shape.pose, rigid(anchorPose(tip, grab.grip)), dt, FOLLOW_TAU) });
  }
  for (const id of released) {
    const shape = shapeOf(id);
    if (shape && !led.has(id)) commands.push({ kind: 'drop', id, pose: frame.options.snap && shape.anchor === 'world' ? settlePose(shape.pose) : shape.pose });
  }
  return { grabs, stretch, commands };
}

// 连接断开、组件停用时替页面收尾：按着的扳机补抬起，指着的面板发移出(页面留着，按住连发的键靠这两样停下)
export function letGo(state: State): Command[] {
  const commands: Command[] = [];
  for (const hand of state.hands) {
    if (hand.press !== null && hand.at) commands.push({ kind: 'input', id: hand.press, event: { kind: 'up', x: hand.at.x, y: hand.at.y } });
  }
  for (const id of Object.keys(state.drivers)) commands.push({ kind: 'input', id, event: { kind: 'leave' } });
  return commands;
}

// 一帧：上一帧的状态加这一帧的输入 → 新的状态和要做的事；dt 是离上一帧多久(秒)
export function step(state: State, frame: Frame, dt: number): { state: State; commands: Command[] } {
  const pointer = pointerEvents(state, frame);
  const grab = planGrab(state, frame, dt);
  const keys: Command[] = [];
  if (frame.toggle) keys.push({ kind: 'toggleAll' });
  if (frame.quick1) keys.push({ kind: 'quick', slot: 1 });
  if (frame.quick2) keys.push({ kind: 'quick', slot: 2 });
  const hand = (h: HandIndex): HandState => ({ ...pointer.hands[h], grab: grab.grabs[h] });
  return {
    state: { hands: [hand(0), hand(1)], drivers: pointer.drivers, stretch: grab.stretch },
    commands: [...pointer.commands, ...grab.commands, ...keys],
  };
}
