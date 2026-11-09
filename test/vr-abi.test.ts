// 拿 vendor/openvr/openvr_capi.h 核对 components/steamvr/src/openvr.ts 里手写的 koffi 声明：
// 每个结构体的大小、对齐、字段(名字、偏移、类型)，每条函数原型的调用约定、参数个数、各参数和返回值的基本类型，
// 以及 fntables.ts 里的方法顺序。按 64 位 Windows 的布局算(头文件里的 #pragma pack 只对 Linux 和 macOS 生效)。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import koffi, { type TypeObject } from 'koffi';
import {
  APP_BACKGROUND, APP_OVERLAY, ENTRY_PROTOS, EVENT_QUIT, HMD_DEVICE, MAX_DEVICES, OpenVR, ORIGIN_STANDING, OVERLAY_KEY_IN_USE, PROP_DISPLAY_FREQUENCY, PROP_RENDER_MODEL,
  PROTOS, ROLE_LEFT, ROLE_RIGHT, TEXTURE_DIRECTX, type VrTables,
} from '../components/steamvr/src/openvr.ts';
import type { Mat34 } from '../components/steamvr/src/geometry.ts';
import {
  IVRApplications_METHODS, IVRApplications_VERSION, IVRInput_METHODS, IVRInput_VERSION, IVROverlay_METHODS, IVROverlay_VERSION,
  IVRRenderModels_METHODS, IVRRenderModels_VERSION, IVRSystem_METHODS, IVRSystem_VERSION,
} from '../components/steamvr/src/fntables.ts';
import { proto } from '../components/steamvr/src/ffi.ts';

const read = (file: string): string => fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// 不含注释的头文件
const code = read('../vendor/openvr/openvr_capi.h').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const source = read('../components/steamvr/src/openvr.ts');

const POINTER_BYTES = 8;   // 64 位进程里指针的字节数

// ---------- C 类型 ----------

type CType =
  | { kind: 'void' }
  | { kind: 'bool' }                                                  // 头文件里是 typedef char bool，1 字节
  | { kind: 'int'; size: number; signed: boolean; word: boolean }     // word：和指针一样宽的整数(intptr_t)
  | { kind: 'float'; size: number }
  | { kind: 'pointer'; to: CType }
  | { kind: 'record'; name: string }                                  // 结构体或联合体
  | { kind: 'opaque'; name: string }                                  // 头文件里没有定义的类型，只能出现在指针后面
  | { kind: 'array'; of: CType; length: number };

const int = (size: number, signed: boolean, word = false): CType => ({ kind: 'int', size, signed, word });
const BASE: Readonly<Record<string, CType>> = {
  void: { kind: 'void' }, bool: { kind: 'bool' }, char: int(1, true),
  int8_t: int(1, true), uint8_t: int(1, false), int16_t: int(2, true), uint16_t: int(2, false),
  int32_t: int(4, true), uint32_t: int(4, false), int64_t: int(8, true), uint64_t: int(8, false),
  int: int(4, true), intptr_t: int(8, true, true), uintptr_t: int(8, false, true),
  float: { kind: 'float', size: 4 }, double: { kind: 'float', size: 8 },
};

// 类型的写法，报错时用；两个类型写法相同就是同一个基本类型
function show(t: CType): string {
  switch (t.kind) {
    case 'void': case 'bool': return t.kind;
    case 'int': return `${t.signed ? 'int' : 'uint'}${t.size * 8}`;
    case 'float': return `float${t.size * 8}`;
    case 'pointer': return `${show(t.to)} *`;
    case 'record': case 'opaque': return t.name;
    case 'array': return `${show(t.of)}[${t.length}]`;
  }
}

// ---------- 头文件 ----------

// typedef A B;
const aliases = new Map<string, string>();
for (const m of code.matchAll(/^typedef\s+([\w ]+?)\s+(\w+)\s*;/gm)) if (m[1] && m[2]) aliases.set(m[2], m[1]);

// 枚举的名字和各个值
const enums = new Set<string>();
const enumValues = new Map<string, number>();
for (const m of code.matchAll(/typedef\s+enum\s+(\w+)\s*\{([^{}]*)\}\s*(\w+)\s*;/g)) {
  if (m[1]) enums.add(m[1]);
  if (m[3]) enums.add(m[3]);
  for (const v of (m[2] ?? '').matchAll(/(\w+)\s*=\s*(-?\d+)/g)) if (v[1]) enumValues.set(v[1], Number(v[2]));
}

// 结构体、联合体、函数表的名字 → 花括号里的内容
const bodies = new Map<string, { union: boolean; body: string }>();
for (const m of code.matchAll(/(?:typedef\s+)?(struct|union)\s*(\w*)\s*\{([^{}]*)\}\s*(\w*)\s*;/g)) {
  const name = m[4] || m[2];
  if (name) bodies.set(name, { union: m[1] === 'union', body: m[3] ?? '' });
}

// 类型的名字 → 类型
function resolve(name: string): CType {
  const base = BASE[name];
  if (base) return base;
  if (enums.has(name)) return int(4, true);
  if (bodies.has(name)) return { kind: 'record', name };
  const alias = aliases.get(name);
  if (alias) return resolve(alias);
  return { kind: 'opaque', name };
}

// 'struct HmdMatrix34_t *'、'const char *'、'EVRInitError' 之类的写法 → 类型
function parseType(text: string): CType {
  const stars = text.split('*').length - 1;
  const name = text.replace(/\*/g, ' ').replace(/\b(const|struct|enum)\b/g, ' ').trim().replace(/\s+/g, ' ');
  let t = resolve(name);
  for (let i = 0; i < stars; i++) t = { kind: 'pointer', to: t };
  assert.ok(stars > 0 || t.kind !== 'opaque', `头文件里没有类型 ${name}`);
  return t;
}

// 一个字段或参数('float m[3][4]'、'char * pchKey') → 名字和类型；多维数组按总长度算
function parseDeclarator(text: string): { name: string; type: CType } {
  const m = /^(.*?)(\w+)\s*((?:\[\d+\]\s*)*)$/.exec(text.trim());
  assert.ok(m?.[1] && m[2], `看不懂的声明：${text}`);
  let type = parseType(m[1]);
  const dims = [...(m[3] ?? '').matchAll(/\[(\d+)\]/g)].map(d => Number(d[1]));
  if (dims.length) type = { kind: 'array', of: type, length: dims.reduce((a, b) => a * b, 1) };
  return { name: m[2], type };
}

interface Field { name: string; type: CType; offset: number }
interface Layout { size: number; align: number; union: boolean; fields: Field[] }

function sizeOf(t: CType): { size: number; align: number } {
  switch (t.kind) {
    case 'bool': return { size: 1, align: 1 };
    case 'int': case 'float': return { size: t.size, align: t.size };
    case 'pointer': return { size: POINTER_BYTES, align: POINTER_BYTES };
    case 'array': {
      const el = sizeOf(t.of);
      return { size: el.size * t.length, align: el.align };
    }
    case 'record': return layout(t.name);
    case 'void': case 'opaque': throw new Error(`${show(t)} 没有大小`);
  }
}

// 结构体或联合体按自然对齐排出来的布局
const layouts = new Map<string, Layout>();
function layout(name: string): Layout {
  const done = layouts.get(name);
  if (done) return done;
  const record = bodies.get(name);
  assert.ok(record, `头文件里没有结构体 ${name}`);
  const fields: Field[] = [];
  let size = 0;
  let align = 1;
  for (const text of record.body.split(';').map(s => s.trim()).filter(Boolean)) {
    const { name: field, type } = parseDeclarator(text);
    const s = sizeOf(type);
    const offset = record.union ? 0 : Math.ceil(size / s.align) * s.align;
    fields.push({ name: field, type, offset });
    size = record.union ? Math.max(size, s.size) : offset + s.size;
    align = Math.max(align, s.align);
  }
  const result: Layout = { size: Math.ceil(size / align) * align, align, union: record.union, fields };
  layouts.set(name, result);
  return result;
}

interface Signature { ret: CType; params: CType[] }

// 括号里的参数表 → 各参数的类型
function parseParams(text: string): CType[] {
  const list = text.trim();
  if (!list || list === 'void') return [];
  return list.split(',').map(p => parseDeclarator(p).type);
}

// 头文件里一个函数的写法：返回类型和括号里的参数表
interface RawSignature { ret: string; params: string }
const signature = (raw: RawSignature): Signature => ({ ret: parseType(raw.ret), params: parseParams(raw.params) });

// 一个接口的函数表：方法名 → 写法，按头文件里的次序
function fnTable(iface: string): Map<string, RawSignature> {
  const table = bodies.get(`VR_${iface}_FnTable`);
  assert.ok(table, `头文件里没有 ${iface} 的函数表`);
  const out = new Map<string, RawSignature>();
  for (const m of table.body.matchAll(/^\s*(.+?)\s*\(OPENVR_FNTABLE_CALLTYPE \*(\w+)\)\((.*)\);\s*$/gm)) {
    if (m[1] && m[2]) out.set(m[2], { ret: m[1], params: m[3] ?? '' });
  }
  return out;
}

// DLL 导出的入口函数(S_API 开头的声明)：名字 → 写法
const entries = new Map<string, RawSignature>();
for (const m of code.matchAll(/^S_API\s+(.+?)\s*\b(VR_\w+)\(\s*(.*?)\s*\);/gm)) {
  if (m[1] && m[2]) entries.set(m[2], { ret: m[1], params: m[3] ?? '' });
}

// ---------- koffi 这边 ----------

const isType = (v: unknown): v is TypeObject => typeof v === 'object' && v !== null && 'primitive' in v && typeof v.primitive === 'string';

// koffi 的类型 → 同一套写法
function fromKoffi(t: TypeObject): CType {
  switch (t.primitive) {
    case 'Void': return { kind: 'void' };
    case 'Bool': return t.size === 1 ? { kind: 'bool' } : int(t.size, false);
    case 'Int8': case 'Int16': case 'Int32': case 'Int64': return int(t.size, true);
    case 'UInt8': case 'UInt16': case 'UInt32': case 'UInt64': return int(t.size, false);
    case 'Float32': case 'Float64': return { kind: 'float', size: t.size };
    case 'String': return { kind: 'pointer', to: int(1, true) };
    case 'Pointer': return { kind: 'pointer', to: t.ref ? fromKoffi(t.ref) : { kind: 'void' } };
    case 'Record': case 'Union': return { kind: 'record', name: t.name };
    case 'Array': {
      assert.ok(t.ref && t.length !== undefined);
      return { kind: 'array', of: fromKoffi(t.ref), length: t.length };
    }
    default: throw new Error(`没想到的 koffi 类型 ${t.primitive}`);
  }
}

// 头文件的类型 h 和 koffi 的类型 k 对不对得上；对不上时返回原因。
// koffi 写 void * 的地方头文件可以是任何指针；头文件是 intptr_t 的地方 koffi 可以写指针；
// 头文件里的联合体，koffi 这边只要大小和对齐相同
function mismatch(h: CType, k: TypeObject): string | null {
  const kt = fromKoffi(k);
  const wrong = `头文件是 ${show(h)}，这里是 ${show(kt)}`;
  if (h.kind === 'pointer') {
    if (kt.kind !== 'pointer') return wrong;
    if (kt.to.kind === 'void') return null;
    return show(h.to) === show(kt.to) ? null : wrong;
  }
  if (h.kind === 'int' && h.word && kt.kind === 'pointer') return null;
  if (h.kind === 'record' && layout(h.name).union && kt.kind !== 'record') {
    const s = layout(h.name);
    return s.size === k.size && s.align === k.alignment ? null : `${wrong}，大小或对齐不同(${s.size}/${s.align} 和 ${k.size}/${k.alignment})`;
  }
  return show(h) === show(kt) ? null : wrong;
}

// 一条 koffi 声明和头文件里的签名对不上的地方
function protoProblems(decl: string, want: Signature, convention: string): string[] {
  const problems: string[] = [];
  const used = /\b__(?:stdcall|cdecl|fastcall|thiscall)\b/.exec(decl)?.[0] ?? '(没写)';
  if (used !== convention) problems.push(`调用约定应该是 ${convention}，这里是 ${used}`);
  const info = proto(decl).proto;
  assert.ok(info);
  const list: unknown = info.arguments;
  assert.ok(Array.isArray(list));
  const args = list.map((a: unknown) => {
    const t = typeof a === 'object' && a !== null && 'type' in a ? a.type : a;   // 每项是 { type, direction }
    assert.ok(isType(t));
    return t;
  });
  if (args.length !== want.params.length) problems.push(`参数个数：头文件 ${want.params.length} 个，这里 ${args.length} 个`);
  else {
    want.params.forEach((h, i) => {
      const k = args[i];
      const why = k ? mismatch(h, k) : '缺参数';
      if (why) problems.push(`第 ${i + 1} 个参数：${why}`);
    });
  }
  const why = mismatch(want.ret, info.result);
  if (why) problems.push(`返回值：${why}`);
  return problems;
}

// ---------- 核对 ----------

const TABLES = {
  IVRSystem: { version: IVRSystem_VERSION, methods: IVRSystem_METHODS },
  IVROverlay: { version: IVROverlay_VERSION, methods: IVROverlay_METHODS },
  IVRInput: { version: IVRInput_VERSION, methods: IVRInput_METHODS },
  IVRApplications: { version: IVRApplications_VERSION, methods: IVRApplications_METHODS },
  IVRRenderModels: { version: IVRRenderModels_VERSION, methods: IVRRenderModels_METHODS },
} as const;

// 头文件里函数表的调用约定(Windows)
const TABLE_CONVENTION = /#if defined\( _WIN32 \)\s*#define OPENVR_FNTABLE_CALLTYPE (\w+)/.exec(code)?.[1] ?? '';
// 入口函数的声明不写调用约定，就是 C 的默认约定
const ENTRY_CONVENTION = '__cdecl';
// 头文件没有声明 VR_InitInternal2：它是 VR_InitInternal 在最后多一个启动信息字符串(const char *)
const INIT2: RawSignature | null = (() => {
  const init = entries.get('VR_InitInternal');
  return init ? { ret: init.ret, params: `${init.params}, const char *pStartupInfo` } : null;
})();

test('头文件：#pragma pack 只在 Linux 和 macOS 的条件里出现', () => {
  const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
  const pushes = lines.flatMap((l, i) => /^#pragma\s+pack\s*\(\s*push/.test(l) ? [i] : []);
  for (const i of pushes) assert.equal(lines[i - 1], '#if defined(__linux__) || defined(__APPLE__)');
  assert.equal(TABLE_CONVENTION, '__stdcall');
});

test('函数表：fntables.ts 的接口版本和方法顺序和头文件一样', () => {
  for (const [iface, t] of Object.entries(TABLES)) {
    assert.equal(new RegExp(`static const char \\* ${iface}_Version = "(\\w+)";`).exec(code)?.[1], t.version, iface);
    assert.deepEqual([...fnTable(iface).keys()], [...t.methods], iface);
  }
});

test('常量：设备数上限、头显的设备序号、左右手、退出事件、应用类型、站立空间、设备属性号、纹理类型、键已占用的错误码和头文件一样', () => {
  assert.equal(Number(/k_unMaxTrackedDeviceCount = (\d+);/.exec(code)?.[1]), MAX_DEVICES);
  assert.equal(Number(/k_unTrackedDeviceIndex_Hmd = (\d+);/.exec(code)?.[1]), HMD_DEVICE);
  assert.equal(enumValues.get('ETrackedControllerRole_TrackedControllerRole_LeftHand'), ROLE_LEFT);
  assert.equal(enumValues.get('ETrackedControllerRole_TrackedControllerRole_RightHand'), ROLE_RIGHT);
  assert.equal(enumValues.get('EVREventType_VREvent_Quit'), EVENT_QUIT);
  assert.equal(enumValues.get('EVRApplicationType_VRApplication_Overlay'), APP_OVERLAY);
  assert.equal(enumValues.get('EVRApplicationType_VRApplication_Background'), APP_BACKGROUND);
  assert.equal(enumValues.get('ETrackingUniverseOrigin_TrackingUniverseStanding'), ORIGIN_STANDING);
  assert.equal(enumValues.get('ETrackedDeviceProperty_Prop_RenderModelName_String'), PROP_RENDER_MODEL);
  assert.equal(enumValues.get('ETrackedDeviceProperty_Prop_DisplayFrequency_Float'), PROP_DISPLAY_FREQUENCY);
  assert.equal(enumValues.get('ETextureType_TextureType_DirectX'), TEXTURE_DIRECTX);
  assert.equal(enumValues.get('EVROverlayError_VROverlayError_KeyInUse'), OVERLAY_KEY_IN_USE);
});

test('常量：连接时以悬浮窗口应用的类型初始化，探测时以后台应用的类型初始化', () => {
  assert.match(source, /static connect\(\): OpenVR \{[\s\S]{0,160}?\binit\(err, APP_OVERLAY, null\);/);
  assert.match(source, /export function steamVrRunning\(\): boolean \{[\s\S]{0,160}?\binit\(err, APP_BACKGROUND, null\);/);
  assert.equal(source.match(/\binit\(err, /g)?.length, 2);
});

// openvr.ts 里用 struct('名字', …) 定义的全部结构体
const STRUCTS = [...new Set([...source.matchAll(/\bstruct\('(\w+)'/g)].map(m => m[1] ?? ''))];

test('结构体：openvr.ts 里定义的都找得到', () => {
  assert.ok(STRUCTS.length >= 12, `只找到 ${STRUCTS.length} 个`);
  for (const name of STRUCTS) assert.ok(bodies.has(name), `头文件里没有 ${name}`);
});

for (const name of STRUCTS) {
  test(`结构体 ${name}：大小、对齐、字段和头文件一样`, () => {
    const k = koffi.type(name);
    const h = layout(name);
    assert.equal(h.union, false);
    assert.deepEqual({ size: k.size, align: k.alignment }, { size: h.size, align: h.align });
    const members = Object.values(k.members ?? {});
    assert.deepEqual(members.map(m => `${m.name} @${m.offset}`), h.fields.map(f => `${f.name} @${f.offset}`));
    const problems = h.fields.flatMap((f, i) => {
      const m = members[i];
      const why = m ? mismatch(f.type, m.type) ?? (sizeOf(f.type).size === m.type.size ? null : `大小 ${sizeOf(f.type).size} 和 ${m.type.size}`) : '缺字段';
      return why ? [`${f.name}：${why}`] : [];
    });
    assert.deepEqual(problems, []);
  });
}

test('原型：openvr.ts 里带调用约定的声明都在 PROTOS 和 ENTRY_PROTOS 里', () => {
  const listed = Object.values(PROTOS).flatMap(group => Object.values<string>(group)).length + Object.keys(ENTRY_PROTOS).length;
  assert.equal(source.match(/\b__(?:stdcall|cdecl|fastcall|thiscall)\b/g)?.length, listed);
});

for (const [iface, group] of Object.entries(PROTOS)) {
  const table = fnTable(iface);
  for (const [method, decl] of Object.entries<string>(group)) {
    test(`原型 ${iface}.${method}：参数和返回值和头文件一样`, () => {
      const want = table.get(method);
      assert.ok(want, `头文件的函数表里没有 ${method}`);
      assert.deepEqual(protoProblems(decl, signature(want), TABLE_CONVENTION), []);
    });
  }
}

for (const [name, decl] of Object.entries<string>(ENTRY_PROTOS)) {
  test(`入口函数 ${name}：名字、参数和返回值和头文件一样`, () => {
    assert.equal(/(\w+)\s*\(/.exec(decl)?.[1], name);   // 声明里的名字就是 DLL 的导出名
    const want = name === 'VR_InitInternal2' ? INIT2 : entries.get(name);
    assert.ok(want, `头文件里没有 ${name}`);
    assert.deepEqual(protoProblems(decl, signature(want), ENTRY_CONVENTION), []);
  });
}

// ---------- 包装方法 ----------

type Fake = (...args: unknown[]) => unknown;

// 记录调用的假函数表：fn(方法名) 给出的函数把「接口.方法名」和参数记下来，返回 answers 里给这个方法定的值
// (定的是函数就调用它，可以往输出参数里写)；没定的返回 0
function wrapped(): { vr: OpenVR; answers: Map<string, unknown>; taken(): unknown[][] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const answers = new Map<string, unknown>();
  const table = (iface: string): { fn<A extends unknown[], R>(method: string): (...args: A) => R } => ({
    fn: <A extends unknown[], R>(method: string) => (...args: A): R => {
      const name = `${iface}.${method}`;
      calls.push({ name, args });
      const answer = answers.get(name);
      return (typeof answer === 'function' ? (answer as Fake)(...args) : answer ?? 0) as R;
    },
  });
  const tables: VrTables = {
    system: table('IVRSystem'), overlay: table('IVROverlay'), input: table('IVRInput'),
    applications: table('IVRApplications'), renderModels: table('IVRRenderModels'),
  };
  // 取走到这时为止的调用，写成 [名字, ...参数]
  const taken = (): unknown[][] => calls.splice(0).map(c => [c.name, ...c.args]);
  return { vr: new OpenVR(tables), answers, taken };
}

const size = (name: string): number => layout(name).size;
const STANDING = enumValues.get('ETrackingUniverseOrigin_TrackingUniverseStanding');
const DIRECTX = enumValues.get('ETextureType_TextureType_DirectX');
const POSE: Mat34 = [1, 0, 0, 0.5, 0, 1, 0, 1.5, 0, 0, 1, -2];
const UNIT: Mat34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

test('包装：悬浮窗口的每个方法调的是函数表里对应的那一项，参数照头文件的次序', () => {
  const { vr, answers, taken } = wrapped();
  answers.set('IVROverlay.CreateOverlay', (_key: unknown, _name: unknown, out: unknown[]) => {
    out[0] = 77;
    return 0;
  });
  assert.equal(vr.overlay('app:panel', 'Panel'), 77);
  assert.deepEqual(taken(), [['IVROverlay.CreateOverlay', 'app:panel', 'Panel', [77]]]);
  // 别的错误码：抛出，不去找
  answers.set('IVROverlay.CreateOverlay', 21);
  assert.throws(() => vr.overlay('app:panel', 'Panel'), /创建悬浮窗口 app:panel 失败 21/);
  assert.deepEqual(taken().map(c => c[0]), ['IVROverlay.CreateOverlay']);
  // 键已经被占着：找到那一个接着用，先把它隐藏
  answers.set('IVROverlay.CreateOverlay', enumValues.get('EVROverlayError_VROverlayError_KeyInUse'));
  answers.set('IVROverlay.FindOverlay', (_key: unknown, out: unknown[]) => {
    out[0] = 88;
    return 0;
  });
  assert.equal(vr.overlay('app:panel', 'Panel'), 88);
  assert.deepEqual(taken(), [['IVROverlay.CreateOverlay', 'app:panel', 'Panel', [88]], ['IVROverlay.FindOverlay', 'app:panel', [88]], ['IVROverlay.HideOverlay', 88]]);
  // 键占着却找不到：抛出建的时候的错误码
  answers.set('IVROverlay.FindOverlay', enumValues.get('EVROverlayError_VROverlayError_UnknownOverlay'));
  assert.throws(() => vr.overlay('app:panel', 'Panel'), /创建悬浮窗口 app:panel 失败 17/);
  taken();
  // 键被别的程序占着(这次连接里没建过这个键)：抛出，不去找、不碰那个悬浮窗口
  answers.set('IVROverlay.FindOverlay', (_key: unknown, out: unknown[]) => {
    out[0] = 99;
    return 0;
  });
  assert.throws(() => vr.overlay('app:other', 'Other'), /创建悬浮窗口 app:other 失败 17/);
  assert.deepEqual(taken().map(c => c[0]), ['IVROverlay.CreateOverlay']);
  // 销毁没成功的还算自己占着的键，能接管；销毁成了以后键再被占着就是别人的
  answers.set('IVROverlay.DestroyOverlay', 10);
  vr.destroy(88);
  assert.equal(vr.overlay('app:panel', 'Panel'), 99);
  answers.delete('IVROverlay.DestroyOverlay');
  vr.destroy(99);
  taken();
  assert.throws(() => vr.overlay('app:panel', 'Panel'), /创建悬浮窗口 app:panel 失败 17/);
  assert.deepEqual(taken().map(c => c[0]), ['IVROverlay.CreateOverlay']);

  assert.deepEqual([vr.show(77), vr.hide(77)], [true, true]);
  vr.destroy(77);
  vr.setWidth(77, 0.8);
  vr.setSortOrder(77, 10);
  assert.equal(vr.setImage(77, 'C:/dot.png'), 0);
  const texture = {};
  vr.setTexture(77, texture);
  vr.place(77, POSE);
  vr.placeOn(77, 3, POSE);
  assert.deepEqual(taken(), [
    ['IVROverlay.ShowOverlay', 77], ['IVROverlay.HideOverlay', 77], ['IVROverlay.DestroyOverlay', 77],
    ['IVROverlay.SetOverlayWidthInMeters', 77, 0.8], ['IVROverlay.SetOverlaySortOrder', 77, 10], ['IVROverlay.SetOverlayFromFile', 77, 'C:/dot.png'],
    ['IVROverlay.SetOverlayTexture', 77, { handle: texture, eType: DIRECTX, eColorSpace: enumValues.get('EColorSpace_ColorSpace_Auto') }],
    ['IVROverlay.SetOverlayTransformAbsolute', 77, STANDING, { m: POSE }],
    ['IVROverlay.SetOverlayTransformTrackedDeviceRelative', 77, 3, { m: POSE }],
  ]);

  // 返回非 0 的错误码：显示、隐藏算没成功，贴图把错误码交回去
  answers.set('IVROverlay.ShowOverlay', 10);
  answers.set('IVROverlay.HideOverlay', 10);
  answers.set('IVROverlay.SetOverlayFromFile', 25);
  assert.deepEqual([vr.show(77), vr.hide(77), vr.setImage(77, 'x')], [false, false, 25]);
  assert.deepEqual(taken().map(c => c[0]), ['IVROverlay.ShowOverlay', 'IVROverlay.HideOverlay', 'IVROverlay.SetOverlayFromFile']);

  assert.equal(vr.intersect(77, [0, 1, 0], [0, 0, -1]), null);
  assert.deepEqual(taken(), [['IVROverlay.ComputeOverlayIntersection', 77, { vSource: { v: [0, 1, 0] }, vDirection: { v: [0, 0, -1] }, eOrigin: STANDING }, {}]]);
  answers.set('IVROverlay.ComputeOverlayIntersection', (_h: unknown, _params: unknown, r: Record<string, unknown>) => {
    r['vUVs'] = { v: [0.25, 0.75] };
    r['vPoint'] = { v: [1, 2, 3] };
    return true;
  });
  assert.deepEqual(vr.intersect(77, [0, 1, 0], [0, 0, -1]), { u: 0.25, v: 0.75, point: [1, 2, 3] });
});

test('包装：输入的每个方法调的是函数表里对应的那一项；更新动作集、读数字动作传的是各自结构体的大小', () => {
  const { vr, answers, taken } = wrapped();
  assert.equal(vr.setManifest('C:/actions.json'), 0);
  const handle = (value: number) => (_name: unknown, out: unknown[]): number => {
    out[0] = value;
    return 0;
  };
  answers.set('IVRInput.GetActionSetHandle', handle(1));
  answers.set('IVRInput.GetActionHandle', handle(2));
  answers.set('IVRInput.GetInputSourceHandle', handle(3));
  assert.deepEqual([vr.handle('set', '/actions/main'), vr.handle('action', '/actions/main/in/Grab'), vr.handle('source', '/user/hand/left')], [1, 2, 3]);
  assert.deepEqual(taken(), [
    ['IVRInput.SetActionManifestPath', 'C:/actions.json'],
    ['IVRInput.GetActionSetHandle', '/actions/main', [1]], ['IVRInput.GetActionHandle', '/actions/main/in/Grab', [2]], ['IVRInput.GetInputSourceHandle', '/user/hand/left', [3]],
  ]);
  answers.set('IVRInput.GetActionHandle', 9);
  assert.throws(() => vr.handle('action', '/x'), /获取 [/]x 句柄失败 9/);
  taken();

  vr.activate(1, 0x01ffffff);
  assert.deepEqual(taken(), [[
    'IVRInput.UpdateActionState', { ulActionSet: 1, ulRestrictedToDevice: 0, ulSecondaryActionSet: 0, unPadding: 0, nPriority: 0x01ffffff }, size('VRActiveActionSet_t'), 1,
  ]]);

  // 读不出(返回错误码)、动作没激活时都算没按
  answers.set('IVRInput.GetDigitalActionData', 7);
  assert.deepEqual(vr.button(2, 3), { down: false, changed: false });
  assert.deepEqual(taken(), [['IVRInput.GetDigitalActionData', 2, {}, size('InputDigitalActionData_t'), 3]]);
  const digital = (data: Record<string, unknown>) => (_action: unknown, d: Record<string, unknown>): number => {
    Object.assign(d, data);
    return 0;
  };
  answers.set('IVRInput.GetDigitalActionData', digital({ bActive: false, bState: true, bChanged: true }));
  assert.deepEqual(vr.button(2, 3), { down: false, changed: false });
  answers.set('IVRInput.GetDigitalActionData', digital({ bActive: true, bState: true, bChanged: false }));
  assert.deepEqual(vr.button(2, 3), { down: true, changed: false });
  answers.set('IVRInput.GetDigitalActionData', digital({ bActive: true, bState: false, bChanged: true }));
  assert.deepEqual(vr.button(2, 3), { down: false, changed: true });
});

test('包装：姿态按站立空间一次取满全部设备，按结构体的大小逐个读；事件传 VREvent_t 的大小，一帧最多取 64 个', () => {
  const { vr, answers, taken } = wrapped();
  const raw = { mDeviceToAbsoluteTracking: { m: POSE }, vVelocity: { v: [0, 0, 0] }, vAngularVelocity: { v: [0, 0, 0] }, eTrackingResult: 200 };
  const step = size('TrackedDevicePose_t');
  answers.set('IVRSystem.GetDeviceToAbsoluteTrackingPose', (_origin: unknown, _predict: unknown, buf: unknown) => {
    // 3 号有效且连着，4 号有效但没连着，5 号连着但姿态无效；最后一个(63 号)有效
    koffi.encode(buf, 3 * step, 'TrackedDevicePose_t', { ...raw, bPoseIsValid: true, bDeviceIsConnected: true });
    koffi.encode(buf, 4 * step, 'TrackedDevicePose_t', { ...raw, bPoseIsValid: true, bDeviceIsConnected: false });
    koffi.encode(buf, 5 * step, 'TrackedDevicePose_t', { ...raw, bPoseIsValid: false, bDeviceIsConnected: true });
    koffi.encode(buf, (MAX_DEVICES - 1) * step, 'TrackedDevicePose_t', { ...raw, bPoseIsValid: true, bDeviceIsConnected: true });
  });
  const pose = vr.poses();
  const [call] = taken();
  assert.deepEqual([call?.[0], call?.[1], call?.[2], call?.[4]], ['IVRSystem.GetDeviceToAbsoluteTrackingPose', STANDING, 0, MAX_DEVICES]);
  assert.deepEqual([pose(3).valid, [...pose(3).mat]], [true, POSE]);   // koffi 读出的矩阵是 Float32Array
  assert.deepEqual([pose(4).valid, pose(5).valid, pose(2).valid, pose(MAX_DEVICES - 1).valid], [false, false, false, true]);
  // 序号在范围外的不读缓冲
  assert.deepEqual([pose(-1), pose(MAX_DEVICES)], [{ valid: false, mat: UNIT }, { valid: false, mat: UNIT }]);

  const queue = [700, 1700, 0];
  answers.set('IVRSystem.PollNextEvent', (ev: Record<string, unknown>) => {
    const type = queue.shift();
    if (type === undefined) return false;
    ev['eventType'] = type;
    return true;
  });
  assert.deepEqual(vr.events(), [700, 1700, 0]);
  const polls = taken();
  assert.equal(polls.length, 4);
  for (const p of polls) assert.deepEqual([p[0], p[2]], ['IVRSystem.PollNextEvent', size('VREvent_t')]);
  answers.set('IVRSystem.PollNextEvent', true);
  assert.equal(vr.events().length, 64);
  taken();

  answers.set('IVRSystem.GetTrackedDeviceIndexForControllerRole', 5);
  assert.equal(vr.roleIndex(ROLE_LEFT), 5);
  assert.deepEqual(taken(), [['IVRSystem.GetTrackedDeviceIndexForControllerRole', ROLE_LEFT]]);
});

test('包装：刷新率、显卡、指尖用的属性号和纹理类型；读不到刷新率时是 90 Hz', () => {
  const { vr, answers, taken } = wrapped();
  const frequency = enumValues.get('ETrackedDeviceProperty_Prop_DisplayFrequency_Float');
  answers.set('IVRSystem.GetFloatTrackedDeviceProperty', 120);
  assert.equal(vr.refreshRate(), 120);
  assert.deepEqual(taken(), [['IVRSystem.GetFloatTrackedDeviceProperty', 0, frequency, [0]]]);
  answers.set('IVRSystem.GetFloatTrackedDeviceProperty', 0);
  assert.equal(vr.refreshRate(), 90);
  answers.set('IVRSystem.GetFloatTrackedDeviceProperty', (_dev: unknown, _prop: unknown, err: unknown[]) => {
    err[0] = 1;
    return 120;
  });
  assert.equal(vr.refreshRate(), 90);
  taken();

  answers.set('IVRSystem.GetOutputDevice', (out: unknown[]) => { out[0] = 0x1234n; });
  assert.equal(vr.outputLuid(), 0x1234n);
  assert.deepEqual(taken(), [['IVRSystem.GetOutputDevice', [0x1234n], DIRECTX, null]]);

  // 指尖：读设备的模型名(返回的长度含结尾的 0)，再取这个模型的 tip 组件
  const model = 'vr_controller';
  answers.set('IVRSystem.GetStringTrackedDeviceProperty', (_dev: unknown, _prop: unknown, buf: Buffer) => {
    buf.write(model);
    return model.length + 1;
  });
  assert.equal(vr.tip(2, 9), null);
  const [nameCall, componentCall] = taken();
  assert.deepEqual([nameCall?.[0], nameCall?.[1], nameCall?.[2], nameCall?.[4], nameCall?.[5]], [
    'IVRSystem.GetStringTrackedDeviceProperty', 2, enumValues.get('ETrackedDeviceProperty_Prop_RenderModelName_String'), 1024, [0],
  ]);
  assert.equal((nameCall?.[3] as Buffer).length, 1024);
  assert.deepEqual(componentCall, ['IVRRenderModels.GetComponentStateForDevicePath', model, 'tip', 9, { bScrollWheelVisible: false }, {}]);
  answers.set('IVRRenderModels.GetComponentStateForDevicePath', (_m: unknown, _c: unknown, _d: unknown, _mode: unknown, out: Record<string, unknown>) => {
    out['mTrackingToComponentLocal'] = { m: POSE };
    return true;
  });
  assert.equal(vr.tip(2, 9), POSE);
  // 读不到模型名时不取组件
  answers.set('IVRSystem.GetStringTrackedDeviceProperty', 0);
  taken();
  assert.equal(vr.tip(2, 9), null);
  assert.deepEqual(taken().map(c => c[0]), ['IVRSystem.GetStringTrackedDeviceProperty']);
});

test('包装：应用没登记过时登记清单并设为随 SteamVR 启动；登记过的不动，登记失败不设自动启动', () => {
  const { vr, answers, taken } = wrapped();
  vr.register('C:/app.vrmanifest', 'yanuo.app');
  assert.deepEqual(taken(), [
    ['IVRApplications.IsApplicationInstalled', 'yanuo.app'], ['IVRApplications.AddApplicationManifest', 'C:/app.vrmanifest', false],
    ['IVRApplications.SetApplicationAutoLaunch', 'yanuo.app', true],
  ]);
  answers.set('IVRApplications.AddApplicationManifest', 107);
  vr.register('C:/app.vrmanifest', 'yanuo.app');
  assert.deepEqual(taken().map(c => c[0]), ['IVRApplications.IsApplicationInstalled', 'IVRApplications.AddApplicationManifest']);
  answers.set('IVRApplications.IsApplicationInstalled', true);
  vr.register('C:/app.vrmanifest', 'yanuo.app');
  assert.deepEqual(taken().map(c => c[0]), ['IVRApplications.IsApplicationInstalled']);
});
