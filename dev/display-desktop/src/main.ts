// 开发用的显示方：把每块显示着的面板显示成一个普通窗口(不用 SteamVR)，提供远程服务 panels。
// 布局用各显示方共用的状态机(打开和收起、总开关、常显、锁、宽度、同时显示的上限)，放在内存里不存盘；
// 同时显示的上限和两个快捷位来自组件的设置。宽度、锁、位置、附着在哪、抬手才显示在窗口上没有效果，照样记进布局、出现在状态里。
// 收起的面板隐藏窗口；清单没写 keep 的，隐藏满 PAGE_LINGER_MS 关掉页面。
// 远程服务 panels 的登记没生效时(别的显示方排在前面)一个窗口都不开，状态里算没连上；生效时照布局开，变回等着时全部关掉。
// 只在带环境变量 FOXPANEL_PANELS=1 启动时由宿主加载，不出现在组件列表里。

import type { MainContext, PanelFeed, Text } from '@konkon-lab/foxpanel-sdk';
import { applyCommand, serveCalls, type PanelsCommand } from '../../../components/_shared/panels/calls.ts';
import {
  dropPanel, emptyLayout, failPanel, PAGE_LINGER_MS, readSettings, retryAll, setOpen, shownSet, viewOf, withCatalog, type Layout,
} from '../../../components/_shared/panels/layout.ts';

// 显示方的名字(远程服务 panels 的状态里的 display)
const NAME: Text = { 'zh-Hans': '桌面显示', 'zh-Hant': '桌面顯示', ja: 'デスクトップ表示', en: 'Desktop display', ko: '데스크톱 표시' };
const REMOVED = 'core/component-removed';   // 核心 → 各组件：一个组件卸载完了，数据是它的 id

// 一块开着页面的面板
interface Shown {
  feed: PanelFeed;                       // 页面的把手
  painting: boolean;                     // 窗口显示着
  timer: NodeJS.Timeout | undefined;     // 窗口隐藏着、等着关页面
}

// 这里用到的宿主服务
export interface DisplayContext {
  panels: MainContext['panels'];
  relay: MainContext['relay'];
  log: MainContext['log'];
  config: MainContext['config'];
  bus: Pick<MainContext['bus'], 'on'>;
  effect(fn: () => () => void): unknown;   // 登记组件停用时的清理
}

export function mount(ctx: DisplayContext): void {
  const settings = readSettings(ctx.config);
  let layout = withCatalog(emptyLayout(false), ctx.panels.list);
  const pages = new Map<string, Shown>();       // 面板 id → 它开着的页面

  // 关掉一块面板的页面
  const close = (id: string, page: Shown): void => {
    clearTimeout(page.timer);
    pages.delete(id);
    page.feed.close();
  };

  // 照布局对一遍再发布状态：该显示的面板开页面或显示窗口；不该显示的隐藏窗口，清单没写 keep 的隐藏满 PAGE_LINGER_MS 关掉页面；
  // 不在目录里的面板关掉页面。登记没生效时页面都关掉、一块都不开
  const sync = (): void => {
    const list = ctx.panels.list;
    const active = serving.active;
    const shown = new Set(active ? shownSet(layout, settings) : []);
    for (const [id, page] of [...pages]) {
      const info = list.find(p => p.id === id);
      if (!info || !active) {
        close(id, page);
      } else if (shown.has(id)) {
        clearTimeout(page.timer);
        page.timer = undefined;
        if (!page.painting) page.feed.setPainting(true);
        page.painting = true;
      } else {
        if (page.painting) page.feed.setPainting(false);
        page.painting = false;
        if (!info.keep) page.timer ??= setTimeout(() => close(id, page), PAGE_LINGER_MS);
      }
    }
    for (const id of shown) if (!pages.has(id)) open(id);
    serving.publish(viewOf(layout, list, settings, { display: NAME, connected: active }));
  };

  // 换成新的布局；和手上的是同一份时什么都不做
  const change = (next: Layout): void => {
    if (next === layout) return;
    layout = next;
    sync();
  };

  // 开一块面板的窗口。页面出错：关掉它、这块面板出错停用(算关着、带原因，再打开时重试)；窗口没了(用户关的、面板不在目录里了)：算关着
  const open = (id: string): void => {
    const feed = ctx.panels.open(id, 'window');
    const page: Shown = { feed, painting: true, timer: undefined };
    pages.set(id, page);
    feed.onState((state, detail) => {
      if (pages.get(id) !== page) return;
      if (state !== 'failed' && state !== 'gone') return;
      clearTimeout(page.timer);
      pages.delete(id);
      if (state === 'failed') {
        const reason = detail ?? 'panel page failed';
        ctx.log(`panel ${id} closed: ${reason}`, 'warn');
        feed.close();
        layout = failPanel(layout, id, reason);
      } else layout = setOpen(layout, settings, id, false);
      sync();
    });
  };

  // 远程服务 panels 的一次调用：作用到布局上
  const run = (command: PanelsCommand): void => change(applyCommand(layout, ctx.panels.list, settings, command));

  const serving = ctx.relay.serve('panels', serveCalls(run));
  // 登记生效了：出错停用的面板重试，照布局开窗口；变回等着：窗口全部关掉
  serving.watch(active => {
    if (active) layout = retryAll(layout);
    sync();
  });
  ctx.panels.watch(list => {
    layout = withCatalog(layout, list);
    sync();
  });
  ctx.bus.on(REMOVED, id => { if (typeof id === 'string') change(dropPanel(layout, id)); });
  ctx.effect(() => () => {
    for (const page of pages.values()) clearTimeout(page.timer);
  });
  sync();
}

export default {
  name: 'yanuo.display-desktop',
  apply: (ctx: MainContext): void => mount(ctx),
};
