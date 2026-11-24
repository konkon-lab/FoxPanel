// SteamVR 组件(独立进程)：自动连接 SteamVR，把面板目录里打开着的面板各显示成一块悬浮窗口，处理手柄
// (扳机点击、握把抓住移动、双手缩放、总开关键、两个快捷位键)；提供远程服务 panels。状态栏上报「STEAMVR」和显示着的面板数。
// 远程服务 panels 的登记生效着才连 SteamVR；等着时(别的显示方排在前面)不连、不开面板页面，状态栏上是没连上。
// 布局(每块面板打开没有、常显、锁定、宽度、附着在哪、抬手才显示、位置，加全局锁)存在组件数据的 layout 键里；显示方的选项、
// 同时显示的上限、两个快捷位指向哪块面板、面板跟不跟着游玩空间、求交的两条退路、纹理怎么交、附着的面板怎么跟着设备是组件的设置。
// openvr_api.dll 在程序目录的 vendor/openvr；SteamVR 应用清单(按源码目录写的和按安装目录写的各一份)、按键绑定、指针贴图在程序目录的 resources/vr。
// 带环境变量 FOXPANEL_VR_SIM 启动时不连 SteamVR，跑模拟脚本(见 sim.ts)。

import path from 'node:path';
import type { MainContext, PanelFeed, Text } from '@konkon-lab/foxpanel-sdk';
import { readLayout, readSettings, type Layout } from '../../_shared/panels/layout.ts';
import { errorText, isObject } from '../../_shared/util.ts';
import type { VrBackend } from './api.ts';
import { Control, LAYOUT_KEY } from './control.ts';
import { useOpenVrDll } from './openvr.ts';
import { Session, type HitSettings } from './session.ts';
import { loadSim, SIM_ENV } from './sim.ts';
import { Stage } from './stage.ts';

// 显示方的名字(远程服务 panels 的状态里的 display)
const NAME: Text = 'SteamVR';
const STATUS_LABEL = 'STEAMVR';                   // 状态栏上的名字
const REMOVED = 'core/component-removed';         // 核心 → 各组件：一个组件卸载完了，数据是它的 id

// 同一个进程里组件停用时留下的布局(含总开关收起着的那一组)：设置改了组件重新加载时接着用，面板不用再按一次总开关键
export interface Carry {
  layout: Layout | null;
}
const CARRY: Carry = { layout: null };

// 组件的设置里求交的两条退路：hitCheck(布尔，默认关)、hitTest(js / native，默认 js)
export function readHit(raw: unknown): HitSettings {
  const config = isObject(raw) ? raw : {};
  return { check: config['hitCheck'] === true, native: config['hitTest'] === 'native' };
}

// 组件的设置里纹理怎么交给 SteamVR：textureSubmit 是 always(每个显示帧都交，默认)或 changed(画面变了才交)；返回是不是每帧都交
export const readEveryFrame = (raw: unknown): boolean => !(isObject(raw) && raw['textureSubmit'] === 'changed');

// 组件的设置里附着的面板怎么跟着设备：attach 是 native(交给 SteamVR 带着走，默认)或 js(每帧自己算位置)；返回是不是交给 SteamVR
export const readAttach = (raw: unknown): boolean => !(isObject(raw) && raw['attach'] === 'js');

// 组件的设置里留在空间里的面板跟不跟着游玩空间：followSpace 是布尔，默认跟着，只有写了 false 才不跟
export const readFollow = (raw: unknown): boolean => !(isObject(raw) && raw['followSpace'] === false);

// SteamVR 应用清单的文件名(在程序目录的 resources/vr 里)。清单里的启动命令是相对清单文件写的：
// 程序的可执行文件在程序目录里面(源码运行，Electron 在 node_modules 里)用 manifest.vrmanifest，
// 在程序目录外面(安装版，可执行文件在安装目录最外层)用 manifest.packed.vrmanifest
export function appManifestName(appDir: string, exe: string): string {
  const rel = path.relative(path.resolve(appDir), path.resolve(exe));
  const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  return inside ? 'manifest.vrmanifest' : 'manifest.packed.vrmanifest';
}

export interface MountOptions {
  exe?: string;                             // 程序的可执行文件，不给时是这个进程的
  backend?: VrBackend;                      // 探测和建连接的方式，不给时用原生的
  tap?: (feed: PanelFeed) => PanelFeed;     // 面板的页面过它一遍再用(模拟模式记指点事件)
  carry?: Carry;                            // 组件停用时布局留在哪，不给时留在这个模块里
}

// 装配：布局读回来(或接着用留下的)之后登记远程服务 panels；登记生效着就开始连 SteamVR
export function mount(ctx: MainContext, options: MountOptions = {}): void {
  useOpenVrDll(path.join(ctx.appDir, 'vendor', 'openvr', 'openvr_api.dll'));
  const res = path.join(ctx.appDir, 'resources', 'vr');
  const carry = options.carry ?? CARRY;
  const tap = options.tap ?? (feed => feed);
  const log: MainContext['log'] = (text, level) => ctx.log(text, level);
  // 状态栏：连上绿、没连灰；连着时名字后面是显示着的面板数。和上一次报的一样时不报
  let reported: number | null = null;   // 上一次报的面板数；没连着是 -1，还没报过是 null
  const report = (connected: boolean, shown: number): void => {
    const count = connected ? shown : -1;
    if (count === reported) return;
    reported = count;
    ctx.status.set(connected ? { led: 'ok', label: STATUS_LABEL, value: String(shown) } : { led: 'idle', label: STATUS_LABEL });
  };
  let stopped = false;
  let control: Control | null = null;
  let session: Session | null = null;

  const begin = (layout: Layout): void => {
    if (stopped) return;
    const board: Control = new Control({
      serve: calls => ctx.relay.serve('panels', calls),
      storage: ctx.storage,
      log,
      display: NAME,
      settings: readSettings(ctx.config),
      list: () => ctx.panels.list,
      connected: () => live.connected,
      report,
    }, layout);
    const stage = new Stage({
      board, open: id => tap(ctx.panels.open(id, 'frames')), log, everyFrame: readEveryFrame(ctx.config), native: readAttach(ctx.config),
    });
    const live: Session = new Session({
      log, stage, board,
      hit: readHit(ctx.config),
      follow: readFollow(ctx.config),
      changed: () => board.link(),
      actionManifest: path.join(res, 'actions.json'),
      appManifest: path.join(res, appManifestName(ctx.appDir, options.exe ?? process.execPath)),
      pointerImage: path.join(res, 'pointer.png'),
    }, options.backend);
    control = board;
    session = live;
    ctx.panels.watch(list => board.catalog(list));
    ctx.bus.on(REMOVED, id => { if (typeof id === 'string') board.removed(id); });
    // 登记生效了：开始连 SteamVR，连上后照布局显示；变回等着：断开，悬浮窗口放掉，面板页面都关掉
    board.watch(active => {
      if (active) return live.start();
      live.stop();
      stage.clear();
    });
    board.flush();
    if (board.active) live.start();
  };

  report(false, 0);
  const kept = carry.layout;
  carry.layout = null;
  if (kept) begin(kept);
  else {
    ctx.storage.get(LAYOUT_KEY)
      .catch((e: unknown) => {
        log(`cannot read layout: ${errorText(e)}`, 'warn');
        return null;
      })
      .then(raw => begin(readLayout(raw)))
      .catch((e: unknown) => log(`cannot start: ${errorText(e)}`, 'error'));
  }
  ctx.effect(() => () => {
    stopped = true;
    if (control) carry.layout = control.layout;
    control?.dispose();
    session?.stop();
  });
}

export default {
  name: 'yanuo.steamvr',
  apply: (ctx: MainContext): void => {
    const script = process.env[SIM_ENV];
    const sim = script ? loadSim(script, (text, level) => ctx.log(text, level)) : null;
    mount(ctx, sim ? { backend: sim.backend, tap: sim.watch } : {});
  },
};
