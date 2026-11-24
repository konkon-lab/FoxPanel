// SteamVR 组件用到的两组原生能力的接口：Vr(悬浮窗口、姿态、输入、应用登记)和 Gpu(共享纹理复制到常驻纹理)。
// 只列组件用到的方法。原生实现是 openvr.ts 的 OpenVR 和 d3d.ts 的 D3D，不碰原生库的实现在 fake.ts。
// 面板空间：这里的姿态、位置、射线共用的坐标系，Y 朝上，单位米；原点和朝向由各个实现定(OpenVR 的见 openvr.ts)。

import type { LogLevel } from '@konkon-lab/foxpanel-sdk';
import type { Mat34, Vec3 } from './geometry.ts';

// 悬浮窗口、动作、动作集、输入源的句柄(uint64；小的数是 number，大的是 bigint)
export type Handle = number | bigint;

// 一个设备的姿态
export interface Pose {
  valid: boolean;   // 姿态有效且设备连着
  mat: Mat34;       // 行主序 3×4
}

// 射线和悬浮窗口的交点：u 从左到右、v 从下到上(v 按边长等于面板宽度的正方形算)，point 是交点在面板空间里的位置
export interface Hit {
  u: number;
  v: number;
  point: Vec3;
}

// 数字动作在一只手上的状态：down 是按着，changed 是和上一次更新动作集时不同
export interface Button {
  down: boolean;
  changed: boolean;
}

export interface Vr {
  // 结束这次会话
  shutdown(): void;

  // ---------- 系统 ----------

  // 头显所在显卡的 LUID，0 = 未知
  outputLuid(): bigint;
  // 头显刷新率(Hz)
  refreshRate(): number;
  // 一只手(ROLE_LEFT / ROLE_RIGHT)的设备序号；没有设备时是 1–63 以外的数
  roleIndex(role: number): number;
  // 取一次全部设备的姿态(面板空间)，返回按设备序号读的函数；0 号是头显
  poses(): (index: number) => Pose;
  // 取出所有待处理事件的类型
  events(): number[];

  // ---------- 悬浮窗口 ----------

  // 建一个悬浮窗口(隐藏着)；键被这次连接里自己建的、没销毁成的悬浮窗口占着时接管那一个并把它隐藏；
  // 建不出来时(键被别的程序占着也算)抛出
  overlay(key: string, name: string): Handle;
  destroy(h: Handle): void;
  // 显示 / 隐藏；返回成没成功
  show(h: Handle): boolean;
  hide(h: Handle): boolean;
  // 宽度(米)
  setWidth(h: Handle, meters: number): void;
  // 排序，大的画在上面
  setSortOrder(h: Handle, order: number): void;
  // 贴一张图片(绝对路径)；返回错误码，0 = 成功
  setImage(h: Handle, file: string): number;
  // 贴一张 Gpu 的纹理
  setTexture(h: Handle, texture: unknown): void;
  // 悬浮窗口在面板空间里的位置
  place(h: Handle, mat: Mat34): void;
  // 悬浮窗口跟着一个设备：mat 是它相对设备 device(设备序号，0 号是头显)的变换，之后由 SteamVR 带着它走
  placeOn(h: Handle, device: number, mat: Mat34): void;
  // 射线(起点 source、方向 dir，面板空间)和悬浮窗口求交；没打中时为 null
  intersect(h: Handle, source: readonly number[], dir: readonly number[]): Hit | null;

  // ---------- 输入 ----------

  // 设置动作清单(actions.json 的路径)；返回错误码，0 = 成功
  setManifest(file: string): number;
  // 动作集、动作、输入源的句柄；取不到时抛出
  handle(kind: 'set' | 'action' | 'source', name: string): Handle;
  // 更新动作状态：激活一个动作集，priority 是它的输入优先级
  activate(set: Handle, priority: number): void;
  // 数字动作在某个输入源(手)上的状态
  button(action: Handle, device: Handle): Button;
  // 手柄模型里指尖相对手柄的变换；取不到时为 null
  tip(index: number, source: Handle): Mat34 | null;

  // ---------- 应用登记 ----------

  // 应用键 key 没登记过时登记应用清单 manifest，并设为随 SteamVR 启动
  register(manifest: string, key: string): void;
}

// 显卡设备丢了(驱动重置、显卡被移除)：这个设备上的调用都不会再成功，要放掉它重新建
export class GpuLost extends Error {}

// 设备丢了时各方法抛出 GpuLost
export interface Gpu {
  // GPU 进度查询(每个悬浮窗口一个)
  createQuery(): unknown;
  // 常驻的 width×height BGRA 纹理
  createTexture(width: number, height: number): unknown;
  // 打开共享纹理的句柄，提交整张复制到 dst 并在 query 上标记；返回打开的源纹理(复制完成后由调用方放掉)
  beginCopy(handle: bigint, dst: unknown, query: unknown): unknown;
  // query 之前提交的复制是否已经完成(不等待)
  done(query: unknown): boolean;
  // 放掉纹理、查询、源纹理；空值不管
  release(obj: unknown): void;
  // 关掉宿主复制进本进程的共享纹理句柄
  closeHandle(handle: bigint): void;
  // 放掉设备
  dispose(): void;
}

// 连接时给的选项
export interface ConnectOptions {
  // 面板空间跟着游玩空间：别的程序挪动游玩空间(调高视角、拖动、转向)时，面板空间留在真实房间里不动，
  // 留在空间里的面板相对人的位置不变；为假时面板空间就是站立空间，面板留在游戏世界里
  follow: boolean;
  log(text: string, level?: LogLevel): void;
}

// 建一次连接用到的三样
export interface VrBackend {
  // SteamVR 装了且正在运行
  running(): boolean;
  // 以悬浮窗口应用身份连接；连不上时抛出
  connect(options: ConnectOptions): Vr;
  // 在 luid 这块显卡上建设备(0 = 默认显卡)；建不出来时抛出
  gpu(luid: bigint): Gpu;
}
