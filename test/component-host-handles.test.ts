import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type * as Handles from '../src/component-host/handles.ts';

// 代替 koffi：记下加载的库、取的函数声明、每次调用的参数；broken 时加载库抛出异常
const native = {
  loads: [] as string[],
  protos: [] as string[],
  closed: [] as unknown[],
  broken: false,
};
const koffi = {
  load(name: string) {
    native.loads.push(name);
    if (native.broken) throw new Error(`cannot load ${name}`);
    return {
      func(proto: string) {
        native.protos.push(proto);
        return (h: unknown): boolean => {
          native.closed.push(h);
          return true;
        };
      },
    };
  },
};

const KEY = Symbol.for('foxpanel.test.handles');
Object.assign(globalThis, { [KEY]: koffi });
const STUB = `data:text/javascript,${encodeURIComponent("export default globalThis[Symbol.for('foxpanel.test.handles')];")}`;
registerHooks({
  resolve: (specifier, context, nextResolve) => (specifier === 'koffi' ? { url: STUB, shortCircuit: true } : nextResolve(specifier, context)),
});

// 一份没加载过库的 handles.ts(地址带上 tag，每个 tag 是单独的一份模块)
const fresh = (tag: string): Promise<typeof Handles> => import(`${new URL('../src/component-host/handles.ts', import.meta.url).href}?${tag}`) as Promise<typeof Handles>;

function reset(broken = false): void {
  native.loads.length = 0;
  native.protos.length = 0;
  native.closed.length = 0;
  native.broken = broken;
}

test('关句柄：第一次用到时加载 kernel32 的 CloseHandle，只加载一次；每个句柄各关一次', async () => {
  reset();
  const { handles } = await fresh('ok');
  // 导入模块时不加载库
  assert.deepEqual([native.loads, native.protos], [[], []]);
  // 库还没加载好时连着关两个：都等到加载好之后关，按调用的先后
  const first = handles.close(1234n);
  const second = handles.close(0xFFFF_FFFF_FFFF_FFFFn);
  assert.ok(first instanceof Promise && second instanceof Promise);
  assert.deepEqual(native.closed, []);
  await Promise.all([first, second]);
  assert.deepEqual(native.closed, [1234n, 0xFFFF_FFFF_FFFF_FFFFn]);
  assert.deepEqual(native.loads, ['kernel32.dll']);
  assert.deepEqual(native.protos, ['bool __stdcall CloseHandle(uint64 h)']);
  // 加载好之后当场关，不返回 promise，也不重新加载
  assert.equal(handles.close(56n), undefined);
  assert.deepEqual(native.closed, [1234n, 0xFFFF_FFFF_FFFF_FFFFn, 56n]);
  assert.deepEqual([native.loads.length, native.protos.length], [1, 1]);
});

test('关句柄：库加载不了时返回的 promise 拒绝，之后每次都拒绝，不反复加载', async () => {
  reset(true);
  const { handles } = await fresh('broken');
  await assert.rejects(async () => handles.close(1n), /cannot load kernel32\.dll/);
  await assert.rejects(async () => handles.close(2n), /cannot load kernel32\.dll/);
  assert.deepEqual([native.loads, native.closed], [['kernel32.dll'], []]);
});
