// 显示方共用的面板布局：每块面板打开没有、常显、锁定、宽度、附着在哪、抬手才显示、位置，加总开关收起的那一组和全局锁。
// 全是纯函数，不碰时间和存储；布局是不可变的值，每个操作给出新的一份，没有变化时给回同一份。
// 显示方的选项、同时显示的上限、两个快捷位是显示方自己的设置(DisplaySettings)，不在布局里，用到的操作各收一份。
// 出错停用的面板和原因也记在布局里(不存盘)：它们算关着，再打开、总开关显示面板(或没有面板可显示、可收起时按总开关)、
// 显示方重新连上时清掉原因重试。
// 显示方把布局、面板目录和设置合成远程服务 panels 的状态(PanelsState)发布出去，把 storedOf 给的那一份存进自己的组件数据。

import type { DisplayOptions, PanelAnchor, PanelInfo, PanelPatch, PanelsState, PanelView, Text } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../util.ts';

export const DISPLAY_LIMIT = 8;        // 同时显示的面板数上限的默认值(块)
export const DISPLAY_LIMIT_MIN = 4;    // 上限能调到的最小值(块)
export const DISPLAY_LIMIT_MAX = 12;   // 上限能调到的最大值(块)
const METERS_GRAIN = 1000;             // 宽度取整到毫米：一米分成这么多格
export const PAGE_LINGER_MS = 60_000;  // 一块面板不显示满这么久(毫秒)、清单没写 keep 的，显示方关掉它的页面
export const HAND_METERS = 0.3;        // 面板变成附着在手上时，比这宽(米)的缩到这么宽(不小于清单的最小宽度)
export const HAND_GRAB_DELAY = 0.4;    // 附着在手上的面板的抓取延迟(秒)，不跟显示方的选项

// 面板能附着的对象：world = 留在空间里，head = 头显，left / right = 左手 / 右手的手柄
export const ANCHORS = ['world', 'head', 'left', 'right'] as const satisfies readonly PanelAnchor[];
export const isAnchor = (v: unknown): v is PanelAnchor => (ANCHORS as readonly unknown[]).includes(v);

// 附着在手上
export const isHand = (anchor: PanelAnchor): anchor is 'left' | 'right' => anchor === 'left' || anchor === 'right';

// 预装的键盘面板的 id：1 号快捷位默认指向它
export const KEYBOARD_PANEL = 'yanuo.shell-classic';

// 抓取延迟能选的值(秒)、恢复时的摆放能选的值
const GRAB_DELAYS = [0, 0.15, 0.4] as const;
const RECENTERS = ['never', 'away', 'always'] as const;

// 面板 id 的格式(和组件 id 一样)
const PANEL_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
export const isPanelId = (v: unknown): v is string => typeof v === 'string' && PANEL_ID.test(v);

// 3×4 仿射矩阵(行主序：前 3 列是 X/Y/Z 轴，第 4 列是位置)
export type Pose = [number, number, number, number, number, number, number, number, number, number, number, number];

// ---------- 显示方的设置 ----------

// 显示方的设置里和布局有关的部分
export interface DisplaySettings {
  options: DisplayOptions;
  limit: number;                                    // 同时显示的上限(块)
  quick: readonly [string | null, string | null];   // 1 号、2 号快捷位指向的面板 id；null = 空位
}

// 显示方的选项的默认值
export const DEFAULT_OPTIONS: DisplayOptions = { blockInput: true, grabDelay: 0.15, stretch: true, snap: true, recenter: 'away' };

// 设置的默认值：1 号快捷位是预装的键盘面板，2 号空着
export const DEFAULT_SETTINGS: DisplaySettings = { options: DEFAULT_OPTIONS, limit: DISPLAY_LIMIT, quick: [KEYBOARD_PANEL, null] };

// 同时显示的上限：取整并夹在能调的范围里；不是有限数时为 undefined
function readLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.min(DISPLAY_LIMIT_MAX, Math.max(DISPLAY_LIMIT_MIN, Math.round(raw)));
}

// 一个快捷位的设置：面板 id；空串或不合格的 id 是空位；不是字符串时用 fallback
const readQuick = (raw: unknown, fallback: string | null): string | null => (typeof raw !== 'string' ? fallback : isPanelId(raw) ? raw : null);

// 显示方组件的设置(ctx.config) → DisplaySettings，坏的项用默认值。认这些键：
// blockInput、stretch、snap(布尔)，grabDelay(0 / 0.15 / 0.4，数字或写成字符串)，recenter(never / away / always)，
// limit(数字)，quick1、quick2(面板 id，空串 = 空位)
export function readSettings(raw: unknown): DisplaySettings {
  const config = isObject(raw) ? raw : {};
  const flag = (key: 'blockInput' | 'stretch' | 'snap'): boolean => {
    const v = config[key];
    return typeof v === 'boolean' ? v : DEFAULT_OPTIONS[key];
  };
  const delay = config['grabDelay'];
  return {
    options: {
      blockInput: flag('blockInput'),
      grabDelay: GRAB_DELAYS.find(v => v === delay || String(v) === delay) ?? DEFAULT_OPTIONS.grabDelay,
      stretch: flag('stretch'),
      snap: flag('snap'),
      recenter: RECENTERS.find(v => v === config['recenter']) ?? DEFAULT_OPTIONS.recenter,
    },
    limit: readLimit(config['limit']) ?? DISPLAY_LIMIT,
    quick: [readQuick(config['quick1'], DEFAULT_SETTINGS.quick[0]), readQuick(config['quick2'], DEFAULT_SETTINGS.quick[1])],
  };
}

// ---------- 布局 ----------

// 一块面板在布局里的记录(存盘)
export interface PanelRecord {
  open: boolean;          // 打开着：用户要它出现(被总开关收起着的也算)
  pinned: boolean;        // 常显：总开关不收起它
  locked: boolean;        // 锁定：不能抓、不能缩放
  meters: number | null;  // 宽度(米)；null = 清单的默认宽度
  anchor: PanelAnchor;    // 附着在哪
  glance: boolean;        // 抬手才显示：附着在手上时只在正面朝向眼睛时显示；附着在别处时不起作用
  // anchor 是 world 时是显示方的面板空间里的姿态，否则是相对附着的设备的变换；
  // null = 还没摆过：world 的显示时按清单的 spawn 放到面前，附着的放在那个设备的默认位置
  pose: Pose | null;
}

export interface Layout {
  stowed: boolean;                       // 总开关收起着(不存盘，每次启动为真)：这时进目录的面板放进收起的那一组；为假时 stash 是空的。
                                         // 开关单块面板后收起的那一组是空的，就不算收起着
  stash: string[];                       // 收起的那一组(不存盘)：打开着、被总开关藏着的面板，都在目录里
  present: string[];                     // 面板目录里的面板 id，按目录的顺序(不存盘)
  locked: boolean;                       // 全局锁：所有面板都不能抓、不能缩放
  panels: Record<string, PanelRecord>;   // 面板 id → 记录；面板不在目录里时记录留着
  errors: Record<string, string>;        // 出错停用的面板 id → 原因(不存盘)，都在目录里；它们算关着，记录里的 open 不动
}

// 存盘的那一份
export interface StoredLayout {
  locked: boolean;
  panels: Record<string, PanelRecord>;
}

// 存盘的记录里坏的项用的值：打开着，没摆过，留在空间里
const BLANK_RECORD: PanelRecord = { open: true, pinned: false, locked: false, meters: null, anchor: 'world', glance: false, pose: null };

// 第一次见到的面板的记录：打开着，没摆过，附着在哪、抬手才显示照清单；附着在手上的锁着
const newRecord = (info: PanelInfo): PanelRecord => ({ ...BLANK_RECORD, locked: isHand(info.anchor), anchor: info.anchor, glance: info.glance });

// 一块面板都没有的布局；stowed = 一开始总开关收起着没有
export const emptyLayout = (stowed: boolean): Layout => ({ stowed, stash: [], present: [], locked: false, panels: {}, errors: {} });

// 宽度(米)，取整到毫米；不是有限的正数时为 undefined
export function readMeters(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.round(raw * METERS_GRAIN) / METERS_GRAIN;
}

// 矩阵：12 个有限数，否则 null
function readPose(raw: unknown): Pose | null {
  if (!Array.isArray(raw) || raw.length !== 12) return null;
  const items: unknown[] = raw;
  const numbers = items.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return numbers.length === 12 ? (numbers as Pose) : null;
}

// 一块面板存盘的记录：坏的项用 BLANK_RECORD 里的值
function readRecord(raw: Record<string, unknown>): PanelRecord {
  const flag = (key: 'open' | 'pinned' | 'locked' | 'glance'): boolean => {
    const v = raw[key];
    return typeof v === 'boolean' ? v : BLANK_RECORD[key];
  };
  const anchor = raw['anchor'];
  return {
    open: flag('open'), pinned: flag('pinned'), locked: flag('locked'), meters: readMeters(raw['meters']) ?? null,
    anchor: isAnchor(anchor) ? anchor : BLANK_RECORD.anchor, glance: flag('glance'), pose: readPose(raw['pose']),
  };
}

// 存盘读回的布局：坏的项用默认值，id 不合格或不是对象的记录丢掉；读不出来时是空的布局。
// 总开关收起着、目录还没给：面板目录到了(withCatalog)，打开着的非常显面板进收起的那一组
export function readLayout(raw: unknown): Layout {
  const layout = emptyLayout(true);
  if (!isObject(raw)) return layout;
  for (const [id, value] of Object.entries(isObject(raw['panels']) ? raw['panels'] : {})) {
    if (isPanelId(id) && isObject(value)) layout.panels[id] = readRecord(value);
  }
  layout.locked = raw['locked'] === true;
  return layout;
}

// 布局里存盘的那一份
export const storedOf = (layout: Layout): StoredLayout => ({ locked: layout.locked, panels: layout.panels });

// ---------- 查 ----------

// 一块面板的记录；没有时为 undefined
export const recordOf = (layout: Layout, id: string): PanelRecord | undefined => (Object.hasOwn(layout.panels, id) ? layout.panels[id] : undefined);

// 一块面板出错停用的原因；没有时为 undefined
export const errorOf = (layout: Layout, id: string): string | undefined => (Object.hasOwn(layout.errors, id) ? layout.errors[id] : undefined);

// 打开着：在目录里、用户要它出现(被总开关收起着的也算)、没有出错停用
export const isOpen = (layout: Layout, id: string): boolean => (
  layout.present.includes(id) && recordOf(layout, id)?.open === true && errorOf(layout, id) === undefined
);

// 打开着、没被总开关收起
const standing = (layout: Layout, id: string): boolean => isOpen(layout, id) && !layout.stash.includes(id);

// 这一刻该显示的面板 id，按目录的顺序：打开着、没被总开关收起的；多过上限时快捷位指向的面板占着位置，其余的只取前面的
export function shownSet(layout: Layout, settings: DisplaySettings): string[] {
  const up = layout.present.filter(id => standing(layout, id));
  if (up.length <= settings.limit) return up;
  const quick = up.filter(id => settings.quick.includes(id));
  const rest = up.filter(id => !quick.includes(id)).slice(0, Math.max(0, settings.limit - quick.length));
  return up.filter(id => quick.includes(id) || rest.includes(id));
}

// 一块面板的实际宽度(米)：布局里记的(没记就是清单的默认宽度)夹在清单的最小和最大之间
export function metersOf(layout: Layout, info: PanelInfo): number {
  return Math.min(info.maxMeters, Math.max(info.minMeters, recordOf(layout, info.id)?.meters ?? info.meters));
}

// 这块面板能抓、能缩放：全局锁和它自己的锁都没锁
export const movable = (layout: Layout, id: string): boolean => !layout.locked && recordOf(layout, id)?.locked === false;

// 这块面板附着在哪；没有记录时算留在空间里
export const anchorOf = (layout: Layout, id: string): PanelAnchor => recordOf(layout, id)?.anchor ?? 'world';

// 这块面板抬手才显示：附着在手上、记录里的 glance 为真
export function glances(layout: Layout, id: string): boolean {
  const record = recordOf(layout, id);
  return record !== undefined && isHand(record.anchor) && record.glance;
}

// 这块面板的抓取延迟(秒)：附着在手上的固定 HAND_GRAB_DELAY，别的照显示方的选项
export const grabDelayOf = (layout: Layout, options: DisplayOptions, id: string): number => (
  isHand(anchorOf(layout, id)) ? HAND_GRAB_DELAY : options.grabDelay
);

// ---------- 目录变化 ----------

// 面板目录变了。进目录的面板(上一份目录里没有的)：第一次见到的加一条记录、算打开，附着在哪、抬手才显示取清单的值，
// 清单写附着在手上的锁着；有记录的照记录；
// 总开关收起着时，打开着的非常显面板放进收起的那一组。
// 不在目录里的面板：记录留着(位置、大小、常显、锁)，从收起的那一组里拿掉，出过的错不留，记成打开——它的组件再打开时面板重新出现
export function withCatalog(layout: Layout, list: readonly PanelInfo[]): Layout {
  const ids = list.map(p => p.id);
  let changed = ids.length !== layout.present.length || ids.some((id, i) => id !== layout.present[i]);
  const panels = { ...layout.panels };
  for (const [id, record] of Object.entries(panels)) {
    if (record.open || ids.includes(id)) continue;
    panels[id] = { ...record, open: true };
    changed = true;
  }
  if (!changed) return layout;
  const errors = Object.keys(layout.errors).every(id => ids.includes(id))
    ? layout.errors : Object.fromEntries(Object.entries(layout.errors).filter(([id]) => ids.includes(id)));
  const stash = layout.stash.filter(id => ids.includes(id));
  for (const info of list) {
    const id = info.id;
    if (layout.present.includes(id)) continue;
    const record = (Object.hasOwn(panels, id) ? panels[id] : undefined) ?? newRecord(info);
    panels[id] = record;
    if (layout.stowed && record.open && !record.pinned) stash.push(id);
  }
  return { ...layout, present: ids, stash, panels, errors };
}

// errors 里拿掉一块面板的；本来就没有时给回同一份
const cleared = (errors: Layout['errors'], id: string): Layout['errors'] => (
  Object.hasOwn(errors, id) ? Object.fromEntries(Object.entries(errors).filter(([key]) => key !== id)) : errors
);

// 组件卸载完了：删掉这块面板的记录，连同它在目录、收起的那一组里的和出过的错
export function dropPanel(layout: Layout, id: string): Layout {
  if (!recordOf(layout, id) && !layout.present.includes(id)) return layout;
  return {
    ...layout,
    present: layout.present.filter(x => x !== id),
    stash: layout.stash.filter(x => x !== id),
    panels: Object.fromEntries(Object.entries(layout.panels).filter(([key]) => key !== id)),
    errors: cleared(layout.errors, id),
  };
}

// ---------- 打开和收起 ----------

// 换掉一块面板的记录
const withRecord = (layout: Layout, id: string, record: PanelRecord): Layout => ({ ...layout, panels: { ...layout.panels, [id]: record } });

// 把一块面板从收起的那一组里拿掉(不在里面也行)；那一组是空的就不算总开关收起着
function unstash(layout: Layout, id: string): Layout {
  const stash = layout.stash.filter(x => x !== id);
  return { ...layout, stash, stowed: layout.stowed && stash.length > 0 };
}

// 打开或关掉一块面板(不动别的)；不在目录里的面板不变。
// 打开：总开关收起着时这一块单独显示(从收起的那一组里拿掉，那一组空了就不算收起着)，出错停用的清掉原因重试；
// 显示着的已到上限时不变，快捷位指向的面板除外。关掉：位置、大小都留着，总开关收起着没有不变
export function setOpen(layout: Layout, settings: DisplaySettings, id: string, on: boolean): Layout {
  const record = recordOf(layout, id);
  if (!record || !layout.present.includes(id)) return layout;
  const errors = cleared(layout.errors, id);
  const panels = record.open === on ? layout.panels : { ...layout.panels, [id]: { ...record, open: on } };
  if (!on) {
    if (panels === layout.panels && errors === layout.errors) return layout;
    return { ...layout, stash: layout.stash.filter(x => x !== id), panels, errors };
  }
  if (standing(layout, id)) return layout;
  if (!settings.quick.includes(id) && shownSet(layout, settings).length >= settings.limit) return layout;
  return { ...unstash(layout, id), panels, errors };
}

// 目录里关着的面板(用它自己的收起按钮、快捷位键、open(id, false) 关掉的那些)，按目录的顺序
const shut = (layout: Layout): string[] => layout.present.filter(id => recordOf(layout, id)?.open === false);

// 总开关：有面板藏着 → 全部显示；否则把打开着的非常显面板整组收起；两样都没有时出错停用的面板清掉原因重试，一块都没有时不变。
// 藏着 = 被它收起着的那一组不是空的，或者目录里有关着的面板(有没有快捷位指向它都算)。
// 全部显示 = 恢复那一组(不算收起着)，关着的面板都打开，出错停用的面板清掉原因重试；打开着的多过上限时显示哪几块照 shownSet。
// 出错停用的面板不算藏着(关着看的是记录里的 open，出错停用的记录里还是打开着)
export function toggleAll(layout: Layout): Layout {
  const closed = shut(layout);
  if (layout.stash.length || closed.length) {
    const panels = closed.length ? { ...layout.panels } : layout.panels;
    for (const id of closed) {
      const record = panels[id];
      if (record) panels[id] = { ...record, open: true };
    }
    return { ...layout, stowed: false, stash: [], panels, errors: retryAll(layout).errors };
  }
  const group = layout.present.filter(id => standing(layout, id) && recordOf(layout, id)?.pinned === false);
  return group.length ? { ...layout, stowed: true, stash: group } : retryAll(layout);
}

// 显示方断开了：算总开关收起着，打开着、没被收起的非常显面板并进收起的那一组，再连上时按总开关恢复；
// 断开期间进目录的面板也进那一组
export function stowAll(layout: Layout): Layout {
  const group = layout.present.filter(id => standing(layout, id) && recordOf(layout, id)?.pinned === false);
  if (!group.length) return layout.stowed ? layout : { ...layout, stowed: true };
  return { ...layout, stowed: true, stash: layout.present.filter(id => layout.stash.includes(id) || group.includes(id)) };
}

// 一块面板出错停用：算关着，带上原因；从收起的那一组里拿掉，记录不动。不在目录里的面板不变
export function failPanel(layout: Layout, id: string, reason: string): Layout {
  if (!layout.present.includes(id) || errorOf(layout, id) === reason) return layout;
  return { ...layout, stash: layout.stash.filter(x => x !== id), errors: { ...layout.errors, [id]: reason } };
}

// 出错停用的面板都清掉原因重试(显示方重新连上时)；一块都没有时给回同一份
export function retryAll(layout: Layout): Layout {
  return Object.keys(layout.errors).length ? { ...layout, errors: {} } : layout;
}

// 快捷位键：开关那个快捷位指向的面板(不动别的)——显示着就关掉，否则打开(显示着的到了上限也打得开)。空位、那块面板不在目录里时不变
export function quickKey(layout: Layout, settings: DisplaySettings, slot: 1 | 2): Layout {
  const id = settings.quick[slot - 1];
  if (id === null || id === undefined) return layout;
  return setOpen(layout, settings, id, !shownSet(layout, settings).includes(id));
}

// ---------- 单块的设置、位置 ----------

// 改一块面板的常显、锁定、宽度、附着在哪、抬手才显示，只改给了的项；不在目录里的面板不变。
// 宽度取整到毫米、夹在这块面板清单的最小和最大之间(不是有限的正数时不改)；设为常显的面板从收起的那一组里拿掉。
// 附着在哪变了：位置忘掉(显示方按附着对象的默认位置放，留在空间里的放到面前)；变成附着在手上时抬手才显示、锁着，
// 比 HAND_METERS 宽的缩到 HAND_METERS(不小于清单的最小宽度)——同一次改动里给了的抬手才显示、锁定、宽度照给的
export function setPanel(layout: Layout, list: readonly PanelInfo[], id: string, patch: PanelPatch): Layout {
  const record = recordOf(layout, id);
  const info = list.find(p => p.id === id);
  if (!record || !info || !layout.present.includes(id)) return layout;
  const meters = readMeters(patch.meters);
  const anchor = isAnchor(patch.anchor) ? patch.anchor : record.anchor;
  const moved = anchor !== record.anchor;
  const toHand = moved && isHand(anchor);
  const narrow = toHand && metersOf(layout, info) > HAND_METERS ? Math.max(HAND_METERS, info.minMeters) : record.meters;
  const next: PanelRecord = {
    ...record,
    pinned: patch.pinned ?? record.pinned,
    locked: patch.locked ?? (toHand || record.locked),
    meters: meters === undefined ? narrow : Math.min(info.maxMeters, Math.max(info.minMeters, meters)),
    anchor,
    glance: patch.glance ?? (toHand || record.glance),
    pose: moved ? null : record.pose,
  };
  const same = next.pinned === record.pinned && next.locked === record.locked && next.meters === record.meters && next.glance === record.glance;
  if (same && !moved) return layout;
  return withRecord(next.pinned && layout.stash.includes(id) ? unstash(layout, id) : layout, id, next);
}

// 全局锁
export const lockAll = (layout: Layout, on: boolean): Layout => (layout.locked === on ? layout : { ...layout, locked: on });

// 忘掉这些面板里留在空间里的那些的位置：没有位置的面板由显示方按清单的 spawn 放到面前；附着的面板不动
function forget(layout: Layout, ids: readonly string[]): Layout {
  const placed = ids.filter(id => anchorOf(layout, id) === 'world' && recordOf(layout, id)?.pose != null);
  if (!placed.length) return layout;
  const panels = { ...layout.panels };
  for (const id of placed) {
    const record = panels[id];
    if (record) panels[id] = { ...record, pose: null };
  }
  return { ...layout, panels };
}

// 到面前：给了 id 时打开那一块(显示着的已到上限、开不了时不变)并忘掉它的位置；没给时忘掉全部显示着的面板的位置。
// 附着在头显或手上的面板位置不动(给了 id 时照样打开)
export function summon(layout: Layout, settings: DisplaySettings, id?: string): Layout {
  if (id === undefined) return forget(layout, shownSet(layout, settings));
  const opened = setOpen(layout, settings, id, true);
  return standing(opened, id) ? forget(opened, [id]) : layout;
}

// 回到清单的默认值：附着在哪、抬手才显示照清单，锁照清单的附着对象(在手上的锁着，别的不锁)，宽度用清单的默认宽度，
// 位置忘掉(显示时按清单的 spawn 或附着对象的默认位置放)；常显、打开没有不动。不在目录里的面板不变
export function reset(layout: Layout, list: readonly PanelInfo[], id: string): Layout {
  const record = recordOf(layout, id);
  const info = list.find(p => p.id === id);
  if (!record || !info || !layout.present.includes(id)) return layout;
  const locked = isHand(info.anchor);
  if (record.pose === null && record.meters === null && record.anchor === info.anchor && record.glance === info.glance && record.locked === locked) return layout;
  return withRecord(layout, id, { ...record, pose: null, meters: null, locked, anchor: info.anchor, glance: info.glance });
}

// 记下一块面板摆在哪(显示方在摆好、松手时调)：留在空间里的记显示方的面板空间里的姿态，附着的记相对附着的设备的变换；没有记录的面板不变
export function place(layout: Layout, id: string, pose: Pose): Layout {
  const record = recordOf(layout, id);
  if (!record || (record.pose && record.pose.every((v, i) => v === pose[i]))) return layout;
  return withRecord(layout, id, { ...record, pose: [...pose] });
}

// ---------- 发布的状态 ----------

// 显示方自己的情况：名字、连没连上、该显示而这一刻没在显示的面板
export interface DisplayStatus {
  display: Text;
  connected: boolean;
  hidden?: readonly string[];   // 这些面板 id 这一刻没在显示：附着的设备不在，或抬手才显示的没朝向眼睛
}

// 布局加面板目录加设置 → 远程服务 panels 的状态，按目录的顺序一块一项。
// open = 打开着(被总开关收起着的也算，出错停用的不算)，visible = 这一刻在显示(显示方没连上时都不在显示，status.hidden 里的不在显示)
export function viewOf(layout: Layout, list: readonly PanelInfo[], settings: DisplaySettings, status: DisplayStatus): PanelsState {
  const shown = new Set(status.connected ? shownSet(layout, settings).filter(id => status.hidden?.includes(id) !== true) : []);
  const panels = list.map((p): PanelView => {
    const record = recordOf(layout, p.id);
    const error = errorOf(layout, p.id);
    return {
      id: p.id, name: p.name, ...(p.icon ? { icon: p.icon } : {}),
      open: isOpen(layout, p.id), visible: shown.has(p.id),
      pinned: record?.pinned === true, locked: record?.locked === true,
      anchor: record?.anchor ?? p.anchor, glance: record?.glance ?? p.glance,
      meters: metersOf(layout, p), minMeters: p.minMeters, maxMeters: p.maxMeters,
      quick: settings.quick[0] === p.id ? 1 : settings.quick[1] === p.id ? 2 : 0,
      ...(error ? { error } : {}),
    };
  });
  return {
    display: status.display, connected: status.connected, stowed: layout.stash.length > 0,
    locked: layout.locked, limit: settings.limit, options: settings.options, panels,
  };
}
