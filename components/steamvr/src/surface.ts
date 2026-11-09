// 一块面板的悬浮窗口：宿主离屏渲染这块面板的页面，每一帧把共享纹理的句柄交过来；复制到常驻纹理后交给 SteamVR。
// 姿态、宽度、显示着没有都记在这里，变了才告诉 SteamVR；不显示时不留帧、不交纹理。
// 纹理每个显示帧都交一次，或者(everyFrame 为假)只在纹理里的内容变了、悬浮窗口刚显示出来时交。
// 位置有两种：站立空间里的绝对位置，或者跟着一个设备(交给 SteamVR 带着走，这里另外记着算出来的站立空间里的姿态)。
// 待命(standby)的悬浮窗口不显示也照常收帧、复制，画面变了就交给 SteamVR：显示出来时已经是最新的画面。

import { createHash } from 'node:crypto';
import type { PanelFeed, PanelFrame } from '@konkon-lab/foxpanel-sdk';
import type { Gpu, Handle, Vr } from './api.ts';
import type { Mat34 } from './geometry.ts';

export const APP_KEY = 'yanuo.foxpanel';   // 和 resources/vr 里应用清单、三份绑定文件的 app_key 相同；也是悬浮窗口键的前缀

const SETTLE_MS = 30;    // 同一帧复制第二次前等的时间(毫秒)
const KEY_LIMIT = 100;   // 悬浮窗口的键最长这么多字符(SteamVR 的上限是 128)
const KEY_HASH = 8;      // 键太长时截断，末尾换成面板 id 的哈希的前这么多位(十六进制)

// 一块面板的悬浮窗口在 SteamVR 里的键
export function overlayKey(id: string): string {
  const key = `${APP_KEY}:panel.${id}`;
  if (key.length <= KEY_LIMIT) return key;
  return key.slice(0, KEY_LIMIT - KEY_HASH) + createHash('sha256').update(id).digest('hex').slice(0, KEY_HASH);
}

export interface SurfaceSpec {
  key: string;         // 悬浮窗口在 SteamVR 里的键
  name: string;        // 悬浮窗口的名字
  meters: number;      // 宽度(米)
  everyFrame: boolean; // 纹理每个显示帧都交给 SteamVR；为假时只在画面变了、悬浮窗口刚显示出来时交
}

const samePose = (a: Mat34, b: Mat34): boolean => a.every((v, i) => v === b[i]);

export class Surface {
  readonly handle: Handle;
  private readonly vr: Vr;
  private readonly gpu: Gpu;
  private readonly log: (text: string) => void;
  private feed: PanelFeed | null = null;      // 面板的页面；没有时不收帧
  private readonly query: unknown;
  private texture: unknown = null;
  private texW = 0;                 // 常驻纹理的宽高(像素)
  private texH = 0;
  private filled = false;           // 纹理里已经有完整的一帧
  private fresh = false;            // 纹理里有还没交给 SteamVR 的内容
  private readonly everyFrame: boolean;
  private latest: PanelFrame | null = null;   // 还没复制的最新一帧
  // 正在用的一帧：复制过几次、上一次复制完成的时间(ms)
  private current: { frame: PanelFrame; copies: number; at: number } | null = null;
  private copying: unknown = null;  // GPU 复制中的源纹理
  private shown = false;            // 悬浮窗口显示着
  private waiting = false;          // 待命：不显示也收帧、复制、交纹理
  private width: number;            // 宽度(米)
  private placed: Mat34 | null = null;   // 在站立空间里的姿态；还没放过时为 null
  // 交给 SteamVR 带着走时跟着的设备(设备序号)和相对它的变换；位置是绝对的、还没放过时为 null
  private riding: { device: number; relative: Mat34 } | null = null;

  // 建悬浮窗口(隐藏着)和进度查询，设好宽度；建不出来时抛出，建到一半的放掉
  constructor(vr: Vr, gpu: Gpu, spec: SurfaceSpec, feed: PanelFeed | null, log: (text: string) => void) {
    this.vr = vr;
    this.gpu = gpu;
    this.log = log;
    this.width = spec.meters;
    this.everyFrame = spec.everyFrame;
    this.handle = vr.overlay(spec.key, spec.name);
    try {
      this.query = gpu.createQuery();
      vr.setWidth(this.handle, spec.meters);
    } catch (e) {
      try { vr.destroy(this.handle); } catch { /* SteamVR 已退出 */ }
      throw e;
    }
    this.attach(feed);
  }

  // 换一个页面(null = 没有页面)：手里的帧还给前一个页面，常驻纹理里的画面留着；换走的页面之后交来的帧直接还
  attach(feed: PanelFeed | null): void {
    this.returnFrames();
    this.feed = feed;
    if (!feed) return;
    feed.onFrame(f => {
      if (this.feed === feed && (this.shown || this.waiting)) return this.onFrame(f);
      this.close(f);
      feed.release(f.seq);
    });
    feed.onDrop(seq => { if (this.feed === feed) this.onDrop(seq); });
  }

  // 关掉一帧的句柄
  private close(f: PanelFrame): void {
    try { this.gpu.closeHandle(f.handle); } catch { /* 句柄已经无效 */ }
  }

  // 用完一帧：关掉句柄，告诉宿主可以放掉
  private drop(f: PanelFrame): void {
    this.close(f);
    this.feed?.release(f.seq);
  }

  // 宿主已经放掉的一帧：手里还留着的关掉句柄，不用它也不还
  private onDrop(seq: number): void {
    if (this.latest?.seq === seq) {
      this.close(this.latest);
      this.latest = null;
    }
    if (this.current?.frame.seq === seq) {
      this.close(this.current.frame);
      this.current = null;
    }
  }

  // 只留最新一帧，等下一个显示帧复制
  private onFrame(f: PanelFrame): void {
    if (this.latest) this.drop(this.latest);
    this.latest = f;
  }

  // 提交一次复制：这一帧 → 常驻纹理(尺寸变了就重建纹理)
  private copy(frame: PanelFrame): void {
    const { width, height } = frame;
    if (width !== this.texW || height !== this.texH) {
      this.log(`纹理 ${width}×${height}`);
      // 新纹理建不出来时不留着已放掉的指针和它的尺寸：下一帧重新建
      this.gpu.release(this.texture);
      this.texture = null;
      this.texW = 0;
      this.texH = 0;
      this.filled = false;
      this.texture = this.gpu.createTexture(width, height);
      this.texW = width;
      this.texH = height;
    }
    this.copying = this.gpu.beginCopy(frame.handle, this.texture, this.query);
  }

  // 放掉正在用的一帧
  private dropCurrent(): void {
    if (this.current) this.drop(this.current.frame);
    this.current = null;
  }

  // 手里的帧(正在用的和等着的)都还给页面
  private returnFrames(): void {
    this.dropCurrent();
    if (this.latest) this.drop(this.latest);
    this.latest = null;
  }

  // 每个显示帧调用：上一次复制完成后换新帧，把纹理交给 SteamVR；不显示时只收掉做到一半的复制，
  // 待命的照常换帧，纹理只在画面变了时交。
  // 新帧到达时 Chromium 可能还没画完，所以同一帧隔 SETTLE_MS 复制第二次，否则静止的画面会停在旧内容上
  submit(): void {
    if (this.copying) {
      if (!this.gpu.done(this.query)) return;
      this.gpu.release(this.copying);
      this.copying = null;
      this.filled = true;
      this.fresh = true;
      if (this.current) this.current.at = performance.now();
    }
    if (!this.shown && !this.waiting) return;
    try {
      if (this.latest) {
        this.dropCurrent();
        this.current = { frame: this.latest, copies: 1, at: 0 };
        this.latest = null;
        this.copy(this.current.frame);
      } else if (this.current?.copies === 1 && performance.now() - this.current.at >= SETTLE_MS) {
        this.current.copies = 2;
        this.copy(this.current.frame);
      } else if (this.current && this.current.copies >= 2) {
        this.dropCurrent();
      }
    } catch (e) {
      this.dropCurrent();
      throw e;
    }
    if (!this.filled || !this.texture || this.copying || !((this.everyFrame && this.shown) || this.fresh)) return;
    this.vr.setTexture(this.handle, this.texture);
    this.fresh = false;
  }

  get visible(): boolean {
    return this.shown;
  }

  // 显示或隐藏；已经是这个状态时不做，没成功的状态不变(下一次再试)。隐藏时手里的帧还给页面，待命的留着
  setShown(on: boolean): void {
    if (this.shown === on) return;
    if (!(on ? this.vr.show(this.handle) : this.vr.hide(this.handle))) return;
    this.shown = on;
    if (on) this.fresh = true;
    else if (!this.waiting) this.returnFrames();
  }

  // 待命着没有
  get standby(): boolean {
    return this.waiting;
  }

  // 待命或不待命；不待命、也没显示着时手里的帧还给页面
  setStandby(on: boolean): void {
    if (this.waiting === on) return;
    this.waiting = on;
    if (!on && !this.shown) this.returnFrames();
  }

  // 在站立空间里的姿态；还没放过时为 null
  get pose(): Mat34 | null {
    return this.placed;
  }

  // 放在站立空间里的 m；和上一次给 SteamVR 的绝对位置一样时不说
  setPose(m: Mat34): void {
    if (!this.riding && this.placed && samePose(this.placed, m)) return;
    this.vr.place(this.handle, m);
    this.placed = m;
    this.riding = null;
  }

  // 跟着一个设备：relative 是相对设备 device 的变换，world 是这一刻算出的站立空间里的姿态(求交、圆点用)。
  // native 为真时交给 SteamVR 带着走，设备或相对变换变了才说；为假时每次把 world 设成绝对位置
  setRiding(device: number, relative: Mat34, world: Mat34, native: boolean): void {
    if (!native) return this.setPose(world);
    if (!this.riding || this.riding.device !== device || !samePose(this.riding.relative, relative)) {
      this.vr.placeOn(this.handle, device, relative);
      this.riding = { device, relative };
    }
    this.placed = world;
  }

  // 宽度(米)
  get meters(): number {
    return this.width;
  }

  setMeters(m: number): void {
    if (this.width === m) return;
    this.vr.setWidth(this.handle, m);
    this.width = m;
  }

  // 纹理的像素：常驻纹理的，还没有纹理时用页面报的；都没有时是 0
  get size(): { width: number; height: number } {
    return { width: this.texW || (this.feed?.width ?? 0), height: this.texH || (this.feed?.height ?? 0) };
  }

  // 放掉全部资源；页面摘掉(手里的帧还给它)，它之后交来的帧直接还
  dispose(): void {
    this.attach(null);
    this.shown = false;
    this.waiting = false;
    try { this.vr.destroy(this.handle); } catch { /* SteamVR 已退出 */ }
    this.gpu.release(this.texture);
    this.texture = null;
    this.gpu.release(this.copying);
    this.copying = null;
    this.gpu.release(this.query);
  }
}
