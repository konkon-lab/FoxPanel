// OpenVR C 接口绑定(koffi 调 vendor/openvr/openvr_api.dll)。只封装组件用到的方法。

import koffi from 'koffi';
import {
  IVRApplications_METHODS, IVRApplications_VERSION, IVRInput_METHODS, IVRInput_VERSION, IVROverlay_METHODS, IVROverlay_VERSION,
  IVRRenderModels_METHODS, IVRRenderModels_VERSION, IVRSystem_METHODS, IVRSystem_VERSION,
} from './fntables.ts';
import { loadLib, proto, PTR_SIZE, struct } from './ffi.ts';
import { IDENTITY, type Mat34, type Vec3 } from './geometry.ts';
import type { Handle, Pose, Vr } from './api.ts';

// ---------- 结构体(按 openvr_capi.h，Windows 下自然对齐)；函数原型里按名字引用 ----------

const HmdMatrix34 = struct('HmdMatrix34_t', { m: koffi.array('float', 12) });
const HmdVector3 = struct('HmdVector3_t', { v: koffi.array('float', 3) });
const HmdVector2 = struct('HmdVector2_t', { v: koffi.array('float', 2) });
const TrackedDevicePose = struct('TrackedDevicePose_t', {
  mDeviceToAbsoluteTracking: HmdMatrix34, vVelocity: HmdVector3, vAngularVelocity: HmdVector3,
  eTrackingResult: 'int', bPoseIsValid: 'bool', bDeviceIsConnected: 'bool',
});
struct('VROverlayIntersectionParams_t', { vSource: HmdVector3, vDirection: HmdVector3, eOrigin: 'int' });
struct('VROverlayIntersectionResults_t', { vPoint: HmdVector3, vNormal: HmdVector3, vUVs: HmdVector2, fDistance: 'float' });
const DigitalActionData = struct('InputDigitalActionData_t', {
  bActive: 'bool', activeOrigin: 'uint64', bState: 'bool', bChanged: 'bool', fUpdateTime: 'float',
});
const ActiveActionSet = struct('VRActiveActionSet_t', {
  ulActionSet: 'uint64', ulRestrictedToDevice: 'uint64', ulSecondaryActionSet: 'uint64', unPadding: 'uint32', nPriority: 'int32',
});
const VREvent = struct('VREvent_t', { eventType: 'uint32', trackedDeviceIndex: 'uint32', eventAgeSeconds: 'float', data: koffi.array('uint64', 6) });
struct('Texture_t', { handle: 'void *', eType: 'int', eColorSpace: 'int' });
struct('RenderModel_ComponentState_t', { mTrackingToComponentRenderModel: HmdMatrix34, mTrackingToComponentLocal: HmdMatrix34, uProperties: 'uint32' });
struct('RenderModel_ControllerMode_State_t', { bScrollWheelVisible: 'bool' });

// 结构体的字节数(原生调用要传)
const SIZE = { digital: koffi.sizeof(DigitalActionData), actionSet: koffi.sizeof(ActiveActionSet), event: koffi.sizeof(VREvent), pose: koffi.sizeof(TrackedDevicePose) };

// openvr_capi.h 里的常量(test/vr-abi.test.ts 拿它们和头文件核对)
export const APP_OVERLAY = 2;                // EVRApplicationType：悬浮窗口应用
export const APP_BACKGROUND = 3;             // EVRApplicationType：后台应用，不会启动 SteamVR，未运行时初始化失败
export const ORIGIN_STANDING = 1;            // ETrackingUniverseOrigin：站立空间
export const MAX_DEVICES = 64;               // k_unMaxTrackedDeviceCount：设备序号的上限
export const HMD_DEVICE = 0;                 // k_unTrackedDeviceIndex_Hmd：头显的设备序号
export const ROLE_LEFT = 1;                  // ETrackedControllerRole：左手
export const ROLE_RIGHT = 2;                 // ETrackedControllerRole：右手
export const EVENT_QUIT = 700;               // EVREventType：SteamVR 正在退出
export const PROP_RENDER_MODEL = 1003;       // ETrackedDeviceProperty：设备模型名(字符串)
export const PROP_DISPLAY_FREQUENCY = 2002;  // ETrackedDeviceProperty：头显刷新率(Hz)
export const TEXTURE_DIRECTX = 0;            // ETextureType：D3D11 纹理
export const OVERLAY_KEY_IN_USE = 17;        // EVROverlayError：悬浮窗口的键已经有了

const DEFAULT_HZ = 90;                // 读不到头显刷新率时用的值(Hz)
const EVENTS_MAX = 64;                // 一帧最多取的事件数
const MODEL_NAME_BYTES = 1024;        // 读设备模型名的缓冲大小(字节)

interface RawPose { mDeviceToAbsoluteTracking: { m: number[] }; bPoseIsValid: boolean; bDeviceIsConnected: boolean }

// 手写的函数原型(koffi 声明)：接口 → 函数表里的方法名 → 声明。test/vr-abi.test.ts 拿它们和 openvr_capi.h 核对
export const PROTOS = {
  IVRSystem: {
    GetDeviceToAbsoluteTrackingPose: 'void __stdcall vrGetPoses(int origin, float predict, void *poses, uint32 count)',
    GetTrackedDeviceIndexForControllerRole: 'uint32 __stdcall vrRoleIndex(int role)',
    GetStringTrackedDeviceProperty: 'uint32 __stdcall vrStringProp(uint32 dev, int prop, void *buf, uint32 size, _Out_ int *err)',
    GetFloatTrackedDeviceProperty: 'float __stdcall vrFloatProp(uint32 dev, int prop, _Out_ int *err)',
    GetOutputDevice: 'void __stdcall vrOutputDevice(_Out_ uint64 *dev, int type, void *vk)',
    PollNextEvent: 'bool __stdcall vrPollEvent(_Out_ VREvent_t *ev, uint32 size)',
  },
  IVROverlay: {
    FindOverlay: 'int __stdcall vrFindOverlay(const char *key, _Out_ uint64 *h)',
    CreateOverlay: 'int __stdcall vrCreateOverlay(const char *key, const char *name, _Out_ uint64 *h)',
    DestroyOverlay: 'int __stdcall vrDestroyOverlay(uint64 h)',
    ShowOverlay: 'int __stdcall vrShowOverlay(uint64 h)',
    HideOverlay: 'int __stdcall vrHideOverlay(uint64 h)',
    SetOverlayWidthInMeters: 'int __stdcall vrSetWidth(uint64 h, float w)',
    SetOverlaySortOrder: 'int __stdcall vrSetSortOrder(uint64 h, uint32 order)',
    SetOverlayFromFile: 'int __stdcall vrSetFromFile(uint64 h, const char *path)',
    SetOverlayTexture: 'int __stdcall vrSetTexture(uint64 h, const Texture_t *tex)',
    SetOverlayTransformAbsolute: 'int __stdcall vrSetTransform(uint64 h, int origin, const HmdMatrix34_t *m)',
    SetOverlayTransformTrackedDeviceRelative: 'int __stdcall vrSetTransformRelative(uint64 h, uint32 device, const HmdMatrix34_t *m)',
    ComputeOverlayIntersection: 'bool __stdcall vrIntersect(uint64 h, const VROverlayIntersectionParams_t *p, _Out_ VROverlayIntersectionResults_t *r)',
  },
  IVRInput: {
    SetActionManifestPath: 'int __stdcall vrSetManifest(const char *path)',
    GetActionSetHandle: 'int __stdcall vrActionSet(const char *name, _Out_ uint64 *h)',
    GetActionHandle: 'int __stdcall vrAction(const char *name, _Out_ uint64 *h)',
    GetInputSourceHandle: 'int __stdcall vrSource(const char *path, _Out_ uint64 *h)',
    UpdateActionState: 'int __stdcall vrUpdate(const VRActiveActionSet_t *sets, uint32 size, uint32 count)',
    GetDigitalActionData: 'int __stdcall vrDigital(uint64 action, _Out_ InputDigitalActionData_t *d, uint32 size, uint64 device)',
  },
  IVRApplications: {
    AddApplicationManifest: 'int __stdcall vrAddManifest(const char *path, bool temp)',
    IsApplicationInstalled: 'bool __stdcall vrIsInstalled(const char *key)',
    SetApplicationAutoLaunch: 'int __stdcall vrAutoLaunch(const char *key, bool on)',
  },
  IVRRenderModels: {
    GetComponentStateForDevicePath: 'bool __stdcall vrComponent(const char *model, const char *component, uint64 device, const RenderModel_ControllerMode_State_t *mode, _Out_ RenderModel_ComponentState_t *out)',
  },
} as const;

// openvr_api.dll 入口函数的声明(koffi)，键是导出名
export const ENTRY_PROTOS = {
  VR_IsRuntimeInstalled: 'bool __cdecl VR_IsRuntimeInstalled()',
  VR_InitInternal2: 'intptr __cdecl VR_InitInternal2(_Out_ int *err, int type, const char *info)',
  VR_ShutdownInternal: 'void __cdecl VR_ShutdownInternal()',
  VR_GetGenericInterface: 'void * __cdecl VR_GetGenericInterface(const char *name, _Out_ int *err)',
} as const;

// 一个接口的函数表里按方法名取函数
interface Table<P extends string> {
  fn<A extends unknown[], R>(name: P): (...args: A) => R;
}

// OpenVR 用到的五个接口的函数表
export interface VrTables {
  system: Table<keyof typeof PROTOS.IVRSystem>;
  overlay: Table<keyof typeof PROTOS.IVROverlay>;
  input: Table<keyof typeof PROTOS.IVRInput>;
  applications: Table<keyof typeof PROTOS.IVRApplications>;
  renderModels: Table<keyof typeof PROTOS.IVRRenderModels>;
}

// 原生的函数表：第 i 个方法在偏移 i × PTR_SIZE；protos 是这个接口里手写了原型的方法
class FnTable<M extends string, P extends M> implements Table<P> {
  private readonly table: unknown;
  private readonly methods: readonly M[];
  private readonly protos: Readonly<Record<P, string>>;

  constructor(table: unknown, methods: readonly M[], protos: Readonly<Record<P, string>>) {
    this.table = table;
    this.methods = methods;
    this.protos = protos;
  }

  fn<A extends unknown[], R>(name: P): (...args: A) => R {
    const i = this.methods.indexOf(name);
    if (i < 0) throw new Error(`OpenVR 函数表中不存在 ${name}`);
    const ptr = koffi.decode(this.table, i * PTR_SIZE, 'void *') as unknown;
    const type = proto(this.protos[name]);
    return (...args: A) => koffi.call(ptr, type, ...args) as R;
  }
}

let dllPath = '';
// openvr_api.dll 的位置(程序目录的 vendor/openvr)；连接前设好
export function useOpenVrDll(file: string): void {
  dllPath = file;
}

// openvr_api.dll 的入口函数
interface Entry {
  installed(): boolean;
  init(err: number[], type: number, info: null): unknown;
  shutdown(): void;
  getInterface(name: string, err: number[]): unknown;
}
let entry: Entry | null = null;
// 入口函数在首次用到时绑定
function api(): Entry {
  if (entry) return entry;
  const lib = loadLib(dllPath);
  entry = {
    installed: lib.func(ENTRY_PROTOS.VR_IsRuntimeInstalled) as Entry['installed'],
    init: lib.func(ENTRY_PROTOS.VR_InitInternal2) as Entry['init'],
    shutdown: lib.func(ENTRY_PROTOS.VR_ShutdownInternal) as Entry['shutdown'],
    getInterface: lib.func(ENTRY_PROTOS.VR_GetGenericInterface) as Entry['getInterface'],
  };
  return entry;
}

// 装了 SteamVR 且 vrserver 正在运行(以后台应用类型尝试初始化，不会启动 SteamVR)
export function steamVrRunning(): boolean {
  const { installed, init, shutdown } = api();
  if (!installed()) return false;
  const err = [0];
  init(err, APP_BACKGROUND, null);
  if (err[0] !== 0) return false;
  shutdown();
  return true;
}

function makeSystem(t: VrTables['system']) {
  return {
    poses: t.fn<[number, number, unknown, number], void>('GetDeviceToAbsoluteTrackingPose'),
    roleIndex: t.fn<[number], number>('GetTrackedDeviceIndexForControllerRole'),
    stringProp: t.fn<[number, number, Buffer, number, number[]], number>('GetStringTrackedDeviceProperty'),
    floatProp: t.fn<[number, number, number[]], number>('GetFloatTrackedDeviceProperty'),
    outputDevice: t.fn<[bigint[], number, null], void>('GetOutputDevice'),
    pollEvent: t.fn<[Record<string, unknown>, number], boolean>('PollNextEvent'),
  };
}

function makeOverlay(t: VrTables['overlay']) {
  return {
    find: t.fn<[string, Handle[]], number>('FindOverlay'),
    create: t.fn<[string, string, Handle[]], number>('CreateOverlay'),
    destroy: t.fn<[Handle], number>('DestroyOverlay'),
    show: t.fn<[Handle], number>('ShowOverlay'),
    hide: t.fn<[Handle], number>('HideOverlay'),
    width: t.fn<[Handle, number], number>('SetOverlayWidthInMeters'),
    sortOrder: t.fn<[Handle, number], number>('SetOverlaySortOrder'),
    fromFile: t.fn<[Handle, string], number>('SetOverlayFromFile'),
    texture: t.fn<[Handle, object], number>('SetOverlayTexture'),
    setTransform: t.fn<[Handle, number, object], number>('SetOverlayTransformAbsolute'),
    setTransformRelative: t.fn<[Handle, number, object], number>('SetOverlayTransformTrackedDeviceRelative'),
    intersect: t.fn<[Handle, object, Record<string, unknown>], boolean>('ComputeOverlayIntersection'),
  };
}

function makeInput(t: VrTables['input']) {
  return {
    manifest: t.fn<[string], number>('SetActionManifestPath'),
    setHandle: t.fn<[string, Handle[]], number>('GetActionSetHandle'),
    actionHandle: t.fn<[string, Handle[]], number>('GetActionHandle'),
    sourceHandle: t.fn<[string, Handle[]], number>('GetInputSourceHandle'),
    update: t.fn<[object, number, number], number>('UpdateActionState'),
    digital: t.fn<[Handle, Record<string, unknown>, number, Handle], number>('GetDigitalActionData'),
  };
}

export class OpenVR implements Vr {
  // 以悬浮窗口应用身份连接 SteamVR；失败抛出带错误码的 Error，取函数表失败时结束已经做完的初始化
  static connect(): OpenVR {
    const { init, shutdown, getInterface } = api();
    const err = [0];
    init(err, APP_OVERLAY, null);
    if (err[0] !== 0) throw new Error(`SteamVR 初始化失败 ${err[0]}`);
    const table = (version: string): unknown => {
      const e = [0];
      const p = getInterface(`FnTable:${version}`, e);
      if (e[0] !== 0 || !p) throw new Error(`无法获取 ${version}(${e[0]})`);
      return p;
    };
    try {
      return new OpenVR({
        system: new FnTable(table(IVRSystem_VERSION), IVRSystem_METHODS, PROTOS.IVRSystem),
        overlay: new FnTable(table(IVROverlay_VERSION), IVROverlay_METHODS, PROTOS.IVROverlay),
        input: new FnTable(table(IVRInput_VERSION), IVRInput_METHODS, PROTOS.IVRInput),
        applications: new FnTable(table(IVRApplications_VERSION), IVRApplications_METHODS, PROTOS.IVRApplications),
        renderModels: new FnTable(table(IVRRenderModels_VERSION), IVRRenderModels_METHODS, PROTOS.IVRRenderModels),
      });
    } catch (e) {
      shutdown();
      throw e;
    }
  }

  private readonly poseBuf: unknown = koffi.alloc(TrackedDevicePose, MAX_DEVICES);
  private readonly owned = new Map<string, Handle>();   // 这次连接里自己建的、还没销毁成的悬浮窗口：键 → 句柄
  private readonly sys: ReturnType<typeof makeSystem>;
  private readonly ov: ReturnType<typeof makeOverlay>;
  private readonly inp: ReturnType<typeof makeInput>;
  private readonly apps: { add: (p: string, temp: boolean) => number; installed: (k: string) => boolean; autoLaunch: (k: string, on: boolean) => number };
  private readonly component: (model: string, comp: string, device: Handle, mode: object, out: Record<string, unknown>) => boolean;

  // 从各接口的函数表里取出用到的函数；连接 SteamVR 用 OpenVR.connect()
  constructor(tables: VrTables) {
    this.sys = makeSystem(tables.system);
    this.ov = makeOverlay(tables.overlay);
    this.inp = makeInput(tables.input);
    const a = tables.applications;
    this.apps = {
      add: a.fn('AddApplicationManifest'),
      installed: a.fn('IsApplicationInstalled'),
      autoLaunch: a.fn('SetApplicationAutoLaunch'),
    };
    this.component = tables.renderModels.fn('GetComponentStateForDevicePath');
  }

  shutdown(): void {
    this.owned.clear();
    api().shutdown();
  }

  // ---------- 系统 ----------

  // 头显所在显卡的 LUID(建 D3D 设备用)，0 = 未知
  outputLuid(): bigint {
    const out = [0n];
    this.sys.outputDevice(out, TEXTURE_DIRECTX, null);
    return BigInt(out[0] ?? 0);
  }

  // 头显刷新率(Hz)，无法获取时为 DEFAULT_HZ
  refreshRate(): number {
    const err = [0];
    const hz = this.sys.floatProp(0, PROP_DISPLAY_FREQUENCY, err);
    return err[0] === 0 && hz > 0 ? hz : DEFAULT_HZ;
  }

  roleIndex(role: number): number {
    return this.sys.roleIndex(role);
  }

  // 当前所有设备的姿态，按设备序号取
  poses(): (index: number) => Pose {
    this.sys.poses(ORIGIN_STANDING, 0, this.poseBuf, MAX_DEVICES);
    return index => {
      if (index < 0 || index >= MAX_DEVICES) return { valid: false, mat: IDENTITY };
      const p = koffi.decode(this.poseBuf, index * SIZE.pose, TrackedDevicePose) as RawPose;
      return { valid: p.bPoseIsValid && p.bDeviceIsConnected, mat: p.mDeviceToAbsoluteTracking.m as Mat34 };
    };
  }

  // 设备的模型名；读不到时为空串
  private renderModelName(index: number): string {
    const buf = Buffer.alloc(MODEL_NAME_BYTES);
    const n = this.sys.stringProp(index, PROP_RENDER_MODEL, buf, buf.length, [0]);
    return n > 1 ? buf.toString('utf8', 0, n - 1) : '';
  }

  // 取出所有待处理事件的类型
  events(): number[] {
    const types: number[] = [];
    for (let k = 0; k < EVENTS_MAX; k++) {
      const ev: Record<string, unknown> = {};
      if (!this.sys.pollEvent(ev, SIZE.event)) break;
      types.push(Number(ev['eventType'] ?? 0));
    }
    return types;
  }

  // ---------- 悬浮窗口 ----------

  // 建一个悬浮窗口；键被这次连接里自己建的、没销毁成的悬浮窗口占着时找到那一个接着用，并把它隐藏。
  // 键被别的程序占着时照样抛出，不碰那个悬浮窗口
  overlay(key: string, name: string): Handle {
    const out: Handle[] = [0];
    const e = this.ov.create(key, name, out);
    if (e === OVERLAY_KEY_IN_USE && this.owned.has(key) && this.ov.find(key, out) === 0) {
      const found = out[0] ?? 0;
      this.owned.set(key, found);
      this.ov.hide(found);
      return found;
    }
    if (e !== 0) throw new Error(`创建悬浮窗口 ${key} 失败 ${e}`);
    const made = out[0] ?? 0;
    this.owned.set(key, made);
    return made;
  }

  // 销毁一个悬浮窗口；销毁成了才从自己占着的键里拿掉
  destroy(h: Handle): void {
    if (this.ov.destroy(h) !== 0) return;
    for (const [key, handle] of this.owned) if (handle === h) this.owned.delete(key);
  }
  show(h: Handle): boolean { return this.ov.show(h) === 0; }
  hide(h: Handle): boolean { return this.ov.hide(h) === 0; }
  setWidth(h: Handle, meters: number): void { this.ov.width(h, meters); }
  setSortOrder(h: Handle, order: number): void { this.ov.sortOrder(h, order); }
  // 贴一张图片(绝对路径，png 等)；返回错误码，0 = 成功
  setImage(h: Handle, file: string): number { return this.ov.fromFile(h, file); }
  setTexture(h: Handle, d3dTexture: unknown): void { this.ov.texture(h, { handle: d3dTexture, eType: TEXTURE_DIRECTX, eColorSpace: 0 }); }

  place(h: Handle, mat: Mat34): void {
    this.ov.setTransform(h, ORIGIN_STANDING, { m: mat });
  }

  placeOn(h: Handle, device: number, mat: Mat34): void {
    this.ov.setTransformRelative(h, device, { m: mat });
  }

  // 射线和悬浮窗口求交；命中返回原始 UV(OpenVR：v=0 在下)和交点
  intersect(h: Handle, source: readonly number[], dir: readonly number[]): { u: number; v: number; point: Vec3 } | null {
    const r: Record<string, unknown> = {};
    if (!this.ov.intersect(h, { vSource: { v: source }, vDirection: { v: dir }, eOrigin: ORIGIN_STANDING }, r)) return null;
    const uv = (r['vUVs'] as { v: number[] }).v;
    const p = (r['vPoint'] as { v: number[] }).v;
    return { u: uv[0] ?? -1, v: uv[1] ?? -1, point: [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] };
  }

  // ---------- 输入 ----------

  setManifest(file: string): number { return this.inp.manifest(file); }

  handle(kind: 'set' | 'action' | 'source', name: string): Handle {
    const out: Handle[] = [0];
    const f = kind === 'set' ? this.inp.setHandle : kind === 'action' ? this.inp.actionHandle : this.inp.sourceHandle;
    const e = f(name, out);
    if (e !== 0) throw new Error(`获取 ${name} 句柄失败 ${e}`);
    return out[0] ?? 0;
  }

  activate(set: Handle, priority: number): void {
    this.inp.update({ ulActionSet: set, ulRestrictedToDevice: 0, ulSecondaryActionSet: 0, unPadding: 0, nPriority: priority }, SIZE.actionSet, 1);
  }

  // 数字动作在某只手上的状态
  button(action: Handle, device: Handle): { down: boolean; changed: boolean } {
    const d: Record<string, unknown> = {};
    if (this.inp.digital(action, d, SIZE.digital, device) !== 0 || !d['bActive']) return { down: false, changed: false };
    return { down: d['bState'] === true, changed: d['bChanged'] === true };
  }

  // 手柄模型 "tip" 组件相对手柄的变换；无法获取时返回 null
  tip(index: number, source: Handle): Mat34 | null {
    const model = this.renderModelName(index);
    if (!model) return null;
    const out: Record<string, unknown> = {};
    if (!this.component(model, 'tip', source, { bScrollWheelVisible: false }, out)) return null;
    return ((out['mTrackingToComponentLocal'] as { m: number[] }).m) as Mat34;
  }

  // ---------- 应用注册 ----------

  // 首次运行时将应用注册到 SteamVR 并设为随 SteamVR 启动
  register(manifest: string, key: string): void {
    if (this.apps.installed(key)) return;
    if (this.apps.add(manifest, false) === 0) this.apps.autoLaunch(key, true);
  }
}
