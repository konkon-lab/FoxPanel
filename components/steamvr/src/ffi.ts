// koffi 的公共部分：DLL 句柄、命名类型(结构体、函数原型)。
// 命名类型是整个进程共用的：组件在进程里重新加载时同名类型已经在了，重复定义会报错，这时取已有的。

import koffi, { type LibraryHandle, type TypeObject } from 'koffi';

export const PTR_SIZE = 8;   // 64 位进程里一个指针的字节数(函数表、虚表每项的大小)

// 库句柄被回收时 koffi 会卸载 DLL，所以按路径一直留着
const libs = new Map<string, LibraryHandle>();
export function loadLib(file: string): LibraryHandle {
  let lib = libs.get(file);
  if (!lib) libs.set(file, lib = koffi.load(file));
  return lib;
}

function named(name: string, make: () => TypeObject): TypeObject {
  try {
    return koffi.type(name);
  } catch {
    return make();
  }
}

// 命名结构体
export const struct = (name: string, def: Record<string, string | TypeObject>): TypeObject => named(name, () => koffi.struct(name, def));

// 按声明字符串定义的函数原型(如 'bool __stdcall Foo(int a)')，名字取括号前的标识符
export function proto(decl: string): TypeObject {
  const name = /(\w+)\s*\(/.exec(decl)?.[1];
  return name ? named(name, () => koffi.proto(decl)) : koffi.proto(decl);
}
