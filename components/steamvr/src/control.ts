// 远程服务 panels 的实现和布局的持有者：调用收窄成命令后作用到布局上(共用的状态机)，发布 PanelsState，把布局存进组件数据。
// 布局的改动先记着：连着 SteamVR 时每帧循环的末尾发布一次(一帧里的改动合成一次)，没连着时当场发布。
// 远程服务的登记生效没有(同名的提供者里排在后面时等着)从这里看。

import type { LogLevel, PanelInfo, PanelsCalls, PanelsState, Served, Serving, StorageService, Text } from '@konkon-lab/foxpanel-sdk';
import { applyCommand, serveCalls, type PanelsCommand } from '../../_shared/panels/calls.ts';
import {
  dropPanel, failPanel, quickKey, retryAll, shownSet, storedOf, stowAll, viewOf, withCatalog, type DisplaySettings, type Layout, type StoredLayout,
} from '../../_shared/panels/layout.ts';
import { errorText } from '../../_shared/util.ts';

export const LAYOUT_KEY = 'layout';   // 布局在组件数据里的键
const SAVE_DELAY_MS = 500;            // 布局变了以后隔这么久(毫秒)存盘；这期间又变了就重新等

// 作用到布局上的命令：远程服务 panels 的调用，加手柄上的快捷位键
export type BoardCommand = PanelsCommand | { kind: 'quick'; slot: 1 | 2 };

// 布局、显示方的设置、面板目录：每帧循环读它们，经这里改布局
export interface Board {
  readonly layout: Layout;
  readonly settings: DisplaySettings;
  readonly list: readonly PanelInfo[];
  // 改布局：fn 给出新的一份，给回同一份就是没变
  change(fn: (layout: Layout) => Layout): void;
  run(command: BoardCommand): void;
  // 一块面板出错停用：算关着，状态里带上原因，不进存盘；再打开、总开关显示面板(或没有面板可显示、可收起时按总开关)、
  // 重新连上时清掉原因重试
  fail(id: string, reason: string): void;
  // 该显示而这一刻没在显示的面板(附着的设备不在、抬手才显示的没朝向眼睛)：状态里它们的 visible 为假
  conceal(ids: readonly string[]): void;
  // 有改动时发布一次状态
  flush(): void;
}

export interface ControlDeps {
  serve(calls: Served<PanelsCalls>): Serving<PanelsState>;   // 登记成远程服务 panels 的提供方
  storage: Pick<StorageService, 'set'>;
  log(text: string, level?: LogLevel): void;
  display: Text;                                     // 显示方的名字
  settings: DisplaySettings;
  list(): readonly PanelInfo[];                      // 面板目录
  connected(): boolean;                              // SteamVR 连着没有
  report(connected: boolean, shown: number): void;   // 连接状态和显示着的面板数变了(状态栏)
}

export class Control implements Board {
  layout: Layout;
  readonly settings: DisplaySettings;
  private readonly deps: ControlDeps;
  private readonly serving: Serving<PanelsState>;
  private dirty = true;                                  // 有还没发布的改动
  private hidden: readonly string[] = [];                // 该显示而这一刻没在显示的面板
  private stored: StoredLayout;                          // 最近存盘(或读回)的那一份
  private timer: NodeJS.Timeout | undefined;             // 等着存盘

  // layout：存盘读回的布局(目录还没给)，或同一个进程里上一次留下的
  constructor(deps: ControlDeps, layout: Layout) {
    this.deps = deps;
    this.settings = deps.settings;
    this.layout = withCatalog(layout, deps.list());
    this.stored = storedOf(this.layout);
    this.serving = deps.serve(serveCalls(command => this.run(command)));
  }

  get list(): readonly PanelInfo[] {
    return this.deps.list();
  }

  // 远程服务 panels 的登记生效着：这个显示方该连 SteamVR、显示面板
  get active(): boolean {
    return this.serving.active;
  }

  // 登记生效没有变了回调；返回取消函数
  watch(fn: (active: boolean) => void): () => void {
    return this.serving.watch(fn);
  }

  change(fn: (layout: Layout) => Layout): void {
    const next = fn(this.layout);
    if (next === this.layout) return;
    this.layout = next;
    this.dirty = true;
  }

  // 命令作用到布局上
  run(command: BoardCommand): void {
    const { settings } = this;
    this.change(layout => (command.kind === 'quick' ? quickKey(layout, settings, command.slot) : applyCommand(layout, this.list, settings, command)));
    this.settle();
  }

  fail(id: string, reason: string): void {
    this.change(layout => failPanel(layout, id, reason));
  }

  conceal(ids: readonly string[]): void {
    if (ids.length === this.hidden.length && ids.every((id, i) => id === this.hidden[i])) return;
    this.hidden = [...ids];
    this.dirty = true;
  }

  // 面板目录变了；面板的名字、图标、宽度范围变了也要发布
  catalog(list: readonly PanelInfo[]): void {
    this.dirty = true;
    this.change(layout => withCatalog(layout, list));
    this.settle();
  }

  // 一个组件卸载完了：删掉它那块面板的记录
  removed(id: string): void {
    this.change(layout => dropPanel(layout, id));
    this.settle();
  }

  // 连接状态变了：断开时把显示着的面板收起(再连上时悬浮窗口是隐藏的，按总开关键恢复)；连上时出错停用的面板重试
  link(): void {
    this.change(this.deps.connected() ? retryAll : stowAll);
    this.dirty = true;
    this.flush();
  }

  // 没连着时没有每帧循环：当场发布
  private settle(): void {
    if (!this.deps.connected()) this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const connected = this.deps.connected();
    const { hidden } = this;
    this.serving.publish(viewOf(this.layout, this.list, this.settings, { display: this.deps.display, connected, hidden }));
    this.deps.report(connected, connected ? shownSet(this.layout, this.settings).filter(id => !hidden.includes(id)).length : 0);
    if (this.layout.locked === this.stored.locked && this.layout.panels === this.stored.panels) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  // 布局存进组件数据
  private save(): void {
    this.timer = undefined;
    this.stored = storedOf(this.layout);
    this.deps.storage.set(LAYOUT_KEY, this.stored).catch((e: unknown) => this.deps.log(`cannot save layout: ${errorText(e)}`, 'warn'));
  }

  // 组件停用：还没存盘的改动马上存
  dispose(): void {
    clearTimeout(this.timer);
    if (this.layout.locked !== this.stored.locked || this.layout.panels !== this.stored.panels) this.save();
  }
}
