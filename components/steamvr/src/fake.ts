// 不碰原生库的 Vr 和 Gpu：每一次调用都记下来，悬浮窗口、纹理的状态放在内存里；
// 头和手的姿态、按键、求交结果、哪个方法出错由外面给。

import { GpuLost, type Button, type Gpu, type Handle, type Hit, type Pose, type Vr } from './api.ts';
import { IDENTITY, mul, type Mat34 } from './geometry.ts';

// 一次调用：哪个对象、方法名、参数
export interface Call {
  on: 'vr' | 'gpu';
  name: string;
  args: readonly unknown[];
}

// 调用记录，和按方法名设的出错
class Recorder<T> {
  readonly calls: Call[];
  private readonly on: Call['on'];
  private readonly failures = new Map<string, string>();

  constructor(on: Call['on'], calls: Call[]) {
    this.on = on;
    this.calls = calls;
  }

  // 让方法 name 每次调用都抛出 message；message 为 null 时恢复正常
  fail(name: keyof T & string, message: string | null): void {
    if (message === null) this.failures.delete(name);
    else this.failures.set(name, message);
  }

  // 方法 name 各次调用的参数，按次序
  args(name: keyof T & string): (readonly unknown[])[] {
    return this.calls.filter(c => c.on === this.on && c.name === name).map(c => c.args);
  }

  // 记一次调用；这个方法设了出错就抛出
  protected note(name: keyof T & string, ...args: unknown[]): void {
    this.calls.push({ on: this.on, name, args });
    const message = this.failures.get(name);
    if (message !== undefined) throw new Error(message);
  }
}

const NO_DEVICE = 0xffffffff;   // k_unTrackedDeviceIndexInvalid：这只手没有设备
const DEFAULT_METERS = 1;       // 悬浮窗口没设过宽度时的宽度(米)

// 一个悬浮窗口的状态
export interface FakeOverlay {
  handle: Handle;
  key: string;
  name: string;
  visible: boolean;
  meters: number;       // 宽度(米)
  sort: number;         // 排序
  pose: Mat34;          // 最近一次放它时给的矩阵：面板空间里的姿态，跟着设备时是相对那个设备的变换
  device: number | null;   // 跟着哪个设备(设备序号)；null = 位置是面板空间里的
  image: string;        // 贴的图片的路径，没贴过是空串
  texture: unknown;     // 贴的纹理，没贴过是 null
  destroyed: boolean;
}

export class FakeVr extends Recorder<Vr> implements Vr {
  luid = 0n;                // outputLuid 的返回值
  hz = 90;                  // refreshRate 的返回值(Hz)
  manifestError = 0;        // setManifest 的返回值
  imageError = 0;           // setImage 的返回值
  priority = 0;             // 最近一次 activate 给的优先级
  closed = false;           // shutdown 调过
  // intersect 的结果：悬浮窗口、射线的起点和方向 → 落点
  hit: (overlay: FakeOverlay, source: readonly number[], dir: readonly number[]) => Hit | null = () => null;
  // 键在这里面的悬浮窗口，显示和隐藏都不成功
  readonly stuck = new Set<string>();
  // 被别的程序占着的键：建这些键的悬浮窗口时抛出
  readonly taken = new Set<string>();
  // 接管过的键(建的时候键被这里建的、没销毁成的悬浮窗口占着)，按次序
  readonly adopted: string[] = [];
  // 建过的全部悬浮窗口(含已销毁的)，按次序
  readonly overlays: FakeOverlay[] = [];

  private next = 1;                                       // 下一个句柄
  private readonly live = new Map<Handle, FakeOverlay>();
  private readonly ids = new Map<string, number>();       // 「种类 名字」→ 动作集、动作、输入源的句柄
  private readonly names = new Map<Handle, string>();     // 动作、输入源的句柄 → 名字
  private readonly devices = new Map<number, Mat34>();    // 设备序号 → 姿态；没有的是无效
  private readonly stale = new Set<number>();             // 姿态无效但矩阵留着的设备
  private readonly roles = new Map<number, number>();     // 哪只手 → 设备序号
  private readonly tips = new Map<number, Mat34>();       // 设备序号 → 指尖相对手柄的变换
  private readonly wanted = new Map<string, boolean>();   // 「动作名 输入源名」→ 按没按着
  private readonly latched = new Map<string, Button>();   // 最近一次 activate 时各按键的状态
  private queue: number[] = [];                           // 待取的事件类型

  // calls：调用记到哪里；和 FakeGpu 给同一个数组时两边的调用按发生的次序排在一起
  constructor(calls: Call[] = []) {
    super('vr', calls);
  }

  // ---------- 外面给的输入 ----------

  // 设备的姿态；null = 姿态无效。0 号是头显
  setPose(index: number, mat: Mat34 | null): void {
    this.stale.delete(index);
    if (mat) this.devices.set(index, mat);
    else this.devices.delete(index);
  }

  // 设备的姿态变成无效，矩阵留着最近设的那份(SteamVR 丢失追踪时给的就是旧矩阵)
  losePose(index: number): void {
    this.stale.add(index);
  }

  // 一只手(ROLE_LEFT / ROLE_RIGHT)的设备序号；null = 没有设备
  setRole(role: number, device: number | null): void {
    if (device === null) this.roles.delete(role);
    else this.roles.set(role, device);
  }

  // 设备的指尖相对手柄的变换；null = 取不到
  setTip(device: number, mat: Mat34 | null): void {
    if (mat) this.tips.set(device, mat);
    else this.tips.delete(device);
  }

  // 动作 action 在输入源 source 上按下或松开(都写路径，如 '/actions/main/in/OverlayGrab'、'/user/hand/left')；下一次 activate 起生效
  press(action: string, source: string, down: boolean): void {
    this.wanted.set(`${action} ${source}`, down);
  }

  // 放一个事件，下一次 events 取走
  emit(type: number): void {
    this.queue.push(type);
  }

  // 键是 key 的悬浮窗口里最近建的那个
  find(key: string): FakeOverlay | undefined {
    return this.overlays.findLast(o => o.key === key);
  }

  // 悬浮窗口这一刻在面板空间里的姿态：跟着设备的按那个设备这一刻的姿态算，设备的姿态无效时为 null
  where(o: FakeOverlay): Mat34 | null {
    if (o.device === null) return o.pose;
    const mat = this.stale.has(o.device) ? undefined : this.devices.get(o.device);
    return mat ? mul(mat, o.pose) : null;
  }

  // handle(kind, name) 发过的句柄；没发过时为 undefined
  id(kind: 'set' | 'action' | 'source', name: string): Handle | undefined {
    return this.ids.get(`${kind} ${name}`);
  }

  // ---------- Vr ----------

  shutdown(): void {
    this.note('shutdown');
    this.closed = true;
    for (const o of this.live.values()) this.retire(o);
  }

  outputLuid(): bigint {
    this.note('outputLuid');
    return this.luid;
  }

  refreshRate(): number {
    this.note('refreshRate');
    return this.hz;
  }

  roleIndex(role: number): number {
    this.note('roleIndex', role);
    return this.roles.get(role) ?? NO_DEVICE;
  }

  poses(): (index: number) => Pose {
    this.note('poses');
    const taken = new Map(this.devices);
    const stale = new Set(this.stale);
    return index => {
      const mat = taken.get(index);
      return mat ? { valid: !stale.has(index), mat } : { valid: false, mat: IDENTITY };
    };
  }

  events(): number[] {
    this.note('events');
    const types = this.queue;
    this.queue = [];
    return types;
  }

  overlay(key: string, name: string): Handle {
    this.note('overlay', key, name);
    if (this.taken.has(key)) throw new Error(`创建悬浮窗口 ${key} 失败 17`);
    for (const o of this.live.values()) {
      if (o.key !== key) continue;
      this.adopted.push(key);
      o.visible = false;
      return o.handle;
    }
    const o: FakeOverlay = {
      handle: this.next++, key, name, visible: false, meters: DEFAULT_METERS, sort: 0, pose: IDENTITY, device: null, image: '', texture: null, destroyed: false,
    };
    this.live.set(o.handle, o);
    this.overlays.push(o);
    return o.handle;
  }

  destroy(h: Handle): void {
    this.note('destroy', h);
    const o = this.live.get(h);
    if (o) this.retire(o);
  }

  show(h: Handle): boolean {
    this.note('show', h);
    return this.setVisible(h, true);
  }

  hide(h: Handle): boolean {
    this.note('hide', h);
    return this.setVisible(h, false);
  }

  setWidth(h: Handle, meters: number): void {
    this.note('setWidth', h, meters);
    const o = this.live.get(h);
    if (o) o.meters = meters;
  }

  setSortOrder(h: Handle, order: number): void {
    this.note('setSortOrder', h, order);
    const o = this.live.get(h);
    if (o) o.sort = order;
  }

  setImage(h: Handle, file: string): number {
    this.note('setImage', h, file);
    const o = this.live.get(h);
    if (o && this.imageError === 0) o.image = file;
    return this.imageError;
  }

  setTexture(h: Handle, texture: unknown): void {
    this.note('setTexture', h, texture);
    const o = this.live.get(h);
    if (o) o.texture = texture;
  }

  place(h: Handle, mat: Mat34): void {
    this.note('place', h, mat);
    const o = this.live.get(h);
    if (!o) return;
    o.pose = mat;
    o.device = null;
  }

  placeOn(h: Handle, device: number, mat: Mat34): void {
    this.note('placeOn', h, device, mat);
    const o = this.live.get(h);
    if (!o) return;
    o.pose = mat;
    o.device = device;
  }

  intersect(h: Handle, source: readonly number[], dir: readonly number[]): Hit | null {
    this.note('intersect', h, source, dir);
    const o = this.live.get(h);
    return o ? this.hit(o, source, dir) : null;
  }

  setManifest(file: string): number {
    this.note('setManifest', file);
    return this.manifestError;
  }

  handle(kind: 'set' | 'action' | 'source', name: string): Handle {
    this.note('handle', kind, name);
    const id = `${kind} ${name}`;
    let h = this.ids.get(id);
    if (h === undefined) {
      h = this.next++;
      this.ids.set(id, h);
      this.names.set(h, name);
    }
    return h;
  }

  activate(set: Handle, priority: number): void {
    this.note('activate', set, priority);
    this.priority = priority;
    for (const [key, down] of this.wanted) this.latched.set(key, { down, changed: down !== (this.latched.get(key)?.down ?? false) });
  }

  button(action: Handle, device: Handle): Button {
    this.note('button', action, device);
    const b = this.latched.get(`${this.names.get(action) ?? ''} ${this.names.get(device) ?? ''}`);
    return b ? { ...b } : { down: false, changed: false };
  }

  tip(index: number, source: Handle): Mat34 | null {
    this.note('tip', index, source);
    return this.tips.get(index) ?? null;
  }

  register(manifest: string, key: string): void {
    this.note('register', manifest, key);
  }

  // 显示或隐藏一个悬浮窗口；返回成没成功
  private setVisible(h: Handle, on: boolean): boolean {
    const o = this.live.get(h);
    if (!o || this.stuck.has(o.key)) return false;
    o.visible = on;
    return true;
  }

  // 销毁一个悬浮窗口
  private retire(o: FakeOverlay): void {
    o.visible = false;
    o.destroyed = true;
    this.live.delete(o.handle);
  }
}

// Gpu 的对象：进度查询、常驻纹理、打开的共享纹理
export type FakeGpuObject =
  | { kind: 'query'; id: number; released: boolean }
  | { kind: 'texture'; id: number; released: boolean; width: number; height: number; frames: bigint[] }   // frames：复制进来的各帧的句柄，按次序
  | { kind: 'source'; id: number; released: boolean; handle: bigint };

export class FakeGpu extends Recorder<Gpu> implements Gpu {
  readonly luid: bigint;                    // 建在哪块显卡上
  busy = false;                             // 为真时提交了的复制一直没完成
  lost = false;                             // 为真时设备丢了：建对象、复制、查进度都抛出 GpuLost
  disposed = false;
  readonly objects: FakeGpuObject[] = [];   // 建过的全部对象(含已放掉的)，按次序
  readonly closed: bigint[] = [];           // 关掉的共享纹理句柄，按次序

  constructor(luid = 0n, calls: Call[] = []) {
    super('gpu', calls);
    this.luid = luid;
  }

  // 还没放掉的对象
  live(): FakeGpuObject[] {
    return this.objects.filter(o => !o.released);
  }

  createQuery(): unknown {
    this.note('createQuery');
    this.working();
    return this.add({ kind: 'query', id: this.objects.length + 1, released: false });
  }

  createTexture(width: number, height: number): unknown {
    this.note('createTexture', width, height);
    this.working();
    return this.add({ kind: 'texture', id: this.objects.length + 1, released: false, width, height, frames: [] });
  }

  beginCopy(handle: bigint, dst: unknown, query: unknown): unknown {
    this.note('beginCopy', handle, dst, query);
    this.working();
    if (this.closed.includes(handle)) throw new Error(`共享纹理句柄 ${handle} 已经关掉`);
    const texture = this.own(dst);
    if (texture?.kind !== 'texture' || texture.released) throw new Error('复制的目标不是可用的纹理');
    const q = this.own(query);
    if (q?.kind !== 'query' || q.released) throw new Error('复制用的不是可用的查询');
    texture.frames.push(handle);
    return this.add({ kind: 'source', id: this.objects.length + 1, released: false, handle });
  }

  done(query: unknown): boolean {
    this.note('done', query);
    this.working();
    return !this.busy;
  }

  release(obj: unknown): void {
    this.note('release', obj);
    if (obj === null || obj === undefined) return;
    const o = this.own(obj);
    if (!o) throw new Error('放掉的不是这里建的对象');
    if (o.released) throw new Error(`${o.kind} ${o.id} 放掉了两次`);
    o.released = true;
  }

  closeHandle(handle: bigint): void {
    this.note('closeHandle', handle);
    this.closed.push(handle);
  }

  dispose(): void {
    this.note('dispose');
    this.alive();
    this.disposed = true;
  }

  private add(o: FakeGpuObject): FakeGpuObject {
    this.objects.push(o);
    return o;
  }

  // obj 是这里建的对象时取出它
  private own(obj: unknown): FakeGpuObject | undefined {
    return this.objects.find(o => o === obj);
  }

  // 设备放掉以后再用就抛出
  private alive(): void {
    if (this.disposed) throw new Error('设备已经放掉');
  }

  // 建对象、复制、查进度：设备放掉以后抛出，设备丢了抛出 GpuLost
  private working(): void {
    this.alive();
    if (this.lost) throw new GpuLost('显卡设备丢了');
  }
}
