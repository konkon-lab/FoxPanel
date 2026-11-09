// D3D11(koffi 调 COM 虚表)：在头显所在显卡上创建设备；将宿主离屏渲染交过来的共享纹理复制到常驻纹理。
// 复制不阻塞：提交后通过事件查询轮询 GPU 是否完成(主线程需运行 VR 输入循环，不能阻塞等待)。

import koffi, { type TypeObject } from 'koffi';
import { loadLib, proto, PTR_SIZE, struct } from './ffi.ts';
import { ID3D11Device1_METHODS, ID3D11DeviceContext_METHODS, IDXGIFactory4_METHODS } from './d3d-vtables.ts';
import { GpuLost, type Gpu } from './api.ts';

struct('GUID', { d1: 'uint32', d2: 'uint16', d3: 'uint16', d4: koffi.array('uint8', 8) });
struct('LUID', { LowPart: 'uint32', HighPart: 'int32' });
struct('D3D11_TEXTURE2D_DESC', {
  Width: 'uint32', Height: 'uint32', MipLevels: 'uint32', ArraySize: 'uint32', Format: 'uint32',
  SampleCount: 'uint32', SampleQuality: 'uint32', Usage: 'uint32', BindFlags: 'uint32', CPUAccessFlags: 'uint32', MiscFlags: 'uint32',
});
struct('D3D11_QUERY_DESC', { Query: 'uint32', MiscFlags: 'uint32' });
struct('D3D11_MAPPED_SUBRESOURCE', { pData: 'void *', RowPitch: 'uint32', DepthPitch: 'uint32' });

// 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' → GUID 结构
function guid(text: string): object {
  const b = Buffer.from(text.replace(/-/g, ''), 'hex');
  return { d1: b.readUInt32BE(0), d2: b.readUInt16BE(4), d3: b.readUInt16BE(6), d4: [...b.subarray(8, 16)] };
}

// 用到的接口 ID
const IID = {
  factory4: guid('1bc6ea02-ef36-464f-bf0c-21ca39e5168a'),    // IDXGIFactory4
  adapter: guid('2411e7e1-12ac-4ccf-bd14-9798e8534dc0'),     // IDXGIAdapter
  device1: guid('a04bfb29-08ef-43d6-a49c-a9bdbdcbe686'),     // ID3D11Device1
  texture2d: guid('6f15aaf2-d208-4e89-9ab4-489535d34f9c'),   // ID3D11Texture2D
};

// Windows SDK 头文件里的常量
const FORMAT_B8G8R8A8_UNORM = 87;    // DXGI_FORMAT
const BIND_SHADER_RESOURCE = 0x8;    // D3D11_BIND_FLAG
const CREATE_BGRA_SUPPORT = 0x20;    // D3D11_CREATE_DEVICE_FLAG
const DRIVER_UNKNOWN = 0;            // D3D_DRIVER_TYPE：指定了显卡时用
const DRIVER_HARDWARE = 1;           // D3D_DRIVER_TYPE：默认显卡
const SDK_VERSION = 7;               // D3D11_SDK_VERSION
const QUERY_EVENT = 0;               // D3D11_QUERY：之前提交的命令都执行完时为真
const GETDATA_DONOTFLUSH = 0x1;      // D3D11_ASYNC_GETDATA_FLAG：查询时不刷新命令缓冲
const USAGE_STAGING = 3;             // D3D11_USAGE：能读回内存的纹理
const CPU_ACCESS_READ = 0x20000;     // D3D11_CPU_ACCESS_FLAG
const MAP_READ = 1;                  // D3D11_MAP
const BGRA_BYTES = 4;                // BGRA 一个像素的字节数
// 设备丢了的 HRESULT：DXGI_ERROR_DEVICE_REMOVED、DEVICE_HUNG、DEVICE_RESET、DRIVER_INTERNAL_ERROR
const DEVICE_LOST = [0x887a0005, 0x887a0006, 0x887a0007, 0x887a0020];

const IUNKNOWN_METHODS = ['QueryInterface', 'AddRef', 'Release'] as const;
const RELEASE = 'uint32 __stdcall Release(void *self)';
const CREATE_TEXTURE = 'int __stdcall CreateTexture2D(void *self, const D3D11_TEXTURE2D_DESC *desc, void *init, _Out_ void **tex)';
const COPY_RESOURCE = 'void __stdcall CopyResource(void *self, void *dst, void *src)';

// 一个 COM 对象：按方法名从虚表取函数指针调用(第一个参数是 this)；取过的函数指针和原型留着
class Com<M extends string> {
  readonly ptr: unknown;
  private readonly methods: readonly M[];
  private readonly bound = new Map<M, { fn: unknown; type: TypeObject }>();

  constructor(ptr: unknown, methods: readonly M[]) {
    this.ptr = ptr;
    this.methods = methods;
  }

  call(name: M, decl: string, ...args: unknown[]): unknown {
    let m = this.bound.get(name);
    if (!m) {
      const index = this.methods.indexOf(name);
      if (index < 0) throw new Error(`虚表中不存在 ${name}`);
      const vtbl = koffi.decode(this.ptr, 'void *') as unknown;
      m = { fn: koffi.decode(vtbl, index * PTR_SIZE, 'void *') as unknown, type: proto(decl) };
      this.bound.set(name, m);
    }
    return koffi.call(m.fn, m.type, this.ptr, ...args) as unknown;
  }
}

type DeviceMethod = typeof ID3D11Device1_METHODS[number];
type ContextMethod = typeof ID3D11DeviceContext_METHODS[number];
type FactoryMethod = typeof IDXGIFactory4_METHODS[number];

// 放掉一个 COM 对象的引用；空指针不管
function releaseCom(ptr: unknown): void {
  if (ptr) new Com(ptr, IUNKNOWN_METHODS).call('Release', RELEASE);
}

// HRESULT(有符号或无符号的 32 位数)是不是设备丢了的那几个
export const deviceLost = (hr: unknown): boolean => DEVICE_LOST.includes(Number(hr) >>> 0);

// HRESULT 为失败时抛出；设备丢了时抛出的是 GpuLost
export function check(hr: unknown, what: string): void {
  const code = Number(hr) >>> 0;
  if (code < 0x80000000) return;
  const text = `${what} 失败 0x${code.toString(16)}`;
  throw deviceLost(code) ? new GpuLost(text) : new Error(text);
}

// LUID 对应的显卡(IDXGIAdapter)；找不到时为 null
function adapterByLuid(luid: bigint): unknown {
  const out: unknown[] = [null];
  check(loadLib('dxgi.dll').func('int __stdcall CreateDXGIFactory1(const GUID *riid, _Out_ void **factory)')(IID.factory4, out), 'CreateDXGIFactory1');
  const factory = new Com<FactoryMethod>(out[0], IDXGIFactory4_METHODS);
  const adapter: unknown[] = [null];
  const hr = factory.call('EnumAdapterByLuid', 'int __stdcall EnumAdapterByLuid(void *self, LUID luid, const GUID *riid, _Out_ void **adapter)',
    { LowPart: Number(luid & 0xffffffffn), HighPart: Number(BigInt.asIntN(32, luid >> 32n)) }, IID.adapter, adapter);
  factory.call('Release', RELEASE);
  return Number(hr) >= 0 ? adapter[0] : null;
}

let closeFn: ((h: bigint) => boolean) | null = null;

export class D3D implements Gpu {
  private readonly device: Com<DeviceMethod>;
  private readonly ctx: Com<ContextMethod>;
  private readonly flag = Buffer.alloc(4);   // GetData 写结果的地方(内容不读)

  // luid：头显所在显卡(IVRSystem::GetOutputDevice)，0 = 默认显卡。失败时放掉已经拿到的对象并抛出
  constructor(luid: bigint) {
    const create = loadLib('d3d11.dll').func('int __stdcall D3D11CreateDevice(void *adapter, int type, void *soft, uint32 flags, void *levels, uint32 n, uint32 sdk, _Out_ void **dev, _Out_ int *level, _Out_ void **ctx)');
    const adapter = luid !== 0n ? adapterByLuid(luid) : null;
    const dev: unknown[] = [null];
    const ctx: unknown[] = [null];
    const created: unknown = create(adapter, adapter ? DRIVER_UNKNOWN : DRIVER_HARDWARE, null, CREATE_BGRA_SUPPORT, null, 0, SDK_VERSION, dev, [0], ctx);
    releaseCom(adapter);
    check(created, 'D3D11CreateDevice');

    // OpenSharedResource1 位于 ID3D11Device1
    const base = new Com(dev[0], ID3D11Device1_METHODS);
    const dev1: unknown[] = [null];
    const queried = base.call('QueryInterface', 'int __stdcall QueryInterface(void *self, const GUID *riid, _Out_ void **out)', IID.device1, dev1);
    base.call('Release', RELEASE);
    if (Number(queried) < 0) releaseCom(ctx[0]);
    check(queried, 'QueryInterface(ID3D11Device1)');
    this.device = new Com(dev1[0], ID3D11Device1_METHODS);
    this.ctx = new Com(ctx[0], ID3D11DeviceContext_METHODS);
  }

  // GPU 进度查询(每个悬浮窗口一个)
  createQuery(): unknown {
    const q: unknown[] = [null];
    check(this.device.call('CreateQuery', 'int __stdcall CreateQuery(void *self, const D3D11_QUERY_DESC *desc, _Out_ void **q)',
      { Query: QUERY_EVENT, MiscFlags: 0 }, q), 'CreateQuery');
    return q[0];
  }

  // 常驻的 width×height BGRA 纹理(SteamVR 从此处读取画面)
  createTexture(width: number, height: number): unknown {
    const out: unknown[] = [null];
    check(this.device.call('CreateTexture2D', CREATE_TEXTURE, {
      Width: width, Height: height, MipLevels: 1, ArraySize: 1, Format: FORMAT_B8G8R8A8_UNORM,
      SampleCount: 1, SampleQuality: 0, Usage: 0, BindFlags: BIND_SHADER_RESOURCE, CPUAccessFlags: 0, MiscFlags: 0,
    }, null, out), 'CreateTexture2D');
    return out[0];
  }

  // 打开共享纹理(NT HANDLE)，提交整张复制到 dst 并在 query 上标记；返回打开的源纹理(GPU 完成后释放)
  beginCopy(handle: bigint, dst: unknown, query: unknown): unknown {
    const src: unknown[] = [null];
    check(this.device.call('OpenSharedResource1', 'int __stdcall OpenSharedResource1(void *self, uint64 handle, const GUID *riid, _Out_ void **res)',
      handle, IID.texture2d, src), 'OpenSharedResource1');
    this.ctx.call('CopyResource', COPY_RESOURCE, dst, src[0]);
    this.ctx.call('End', 'void __stdcall End(void *self, void *q)', query);
    this.ctx.call('Flush', 'void __stdcall Flush(void *self)');
    return src[0];
  }

  // query 之前提交的 GPU 命令是否均已完成(不等待)；设备丢了时抛出 GpuLost，别的失败算还没完成
  done(query: unknown): boolean {
    const hr = this.ctx.call('GetData', 'int __stdcall GetData(void *self, void *q, void *data, uint32 size, uint32 flags)',
      query, this.flag, this.flag.length, GETDATA_DONOTFLUSH);
    if (deviceLost(hr)) check(hr, 'GetData');
    return Number(hr) === 0;
  }

  // 放掉纹理、查询等 COM 对象；空指针不管
  release(obj: unknown): void {
    releaseCom(obj);
  }

  // 放掉设备上下文和设备(断开 SteamVR 时)
  dispose(): void {
    this.ctx.call('Release', RELEASE);
    this.device.call('Release', RELEASE);
  }

  // 关掉宿主复制进来的 NT 句柄
  closeHandle(handle: bigint): void {
    closeFn ??= loadLib('kernel32.dll').func('bool __stdcall CloseHandle(uint64 h)') as (h: bigint) => boolean;
    closeFn(handle);
  }

  // 把一张 width×height 的 BGRA 纹理读回内存：每行 width×4 字节，从上到下。只给模拟模式用：等 GPU 把之前提交的命令做完才返回
  readback(texture: unknown, width: number, height: number): Buffer {
    const staging: unknown[] = [null];
    check(this.device.call('CreateTexture2D', CREATE_TEXTURE, {
      Width: width, Height: height, MipLevels: 1, ArraySize: 1, Format: FORMAT_B8G8R8A8_UNORM,
      SampleCount: 1, SampleQuality: 0, Usage: USAGE_STAGING, BindFlags: 0, CPUAccessFlags: CPU_ACCESS_READ, MiscFlags: 0,
    }, null, staging), 'CreateTexture2D');
    try {
      this.ctx.call('CopyResource', COPY_RESOURCE, staging[0], texture);
      const mapped: { pData?: unknown; RowPitch?: number } = {};
      check(this.ctx.call('Map', 'int __stdcall Map(void *self, void *res, uint32 sub, uint32 type, uint32 flags, _Out_ D3D11_MAPPED_SUBRESOURCE *out)',
        staging[0], 0, MAP_READ, 0, mapped), 'Map');
      try {
        const row = width * BGRA_BYTES;
        const pitch = mapped.RowPitch ?? 0;
        if (!mapped.pData || pitch < row) throw new Error(`Map 给的行距 ${pitch} 不对`);
        // 逐行拷出来(拷进 JS 自己的内存；直接映射显存那块内存的缓冲区在这个进程里建不出来)
        const line = koffi.array('uint8', row, 'Typed');
        const out = Buffer.alloc(row * height);
        for (let y = 0; y < height; y++) out.set(koffi.decode(mapped.pData, y * pitch, line) as Uint8Array, y * row);
        return out;
      } finally {
        this.ctx.call('Unmap', 'void __stdcall Unmap(void *self, void *res, uint32 sub)', staging[0], 0);
      }
    } finally {
      releaseCom(staging[0]);
    }
  }
}
