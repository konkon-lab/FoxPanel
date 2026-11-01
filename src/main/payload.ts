// 页面和组件进程发来的数据的大小：远程调用的参数、页面发的总线消息按它限制。

// 一个值存成 JSON 的字节数(BigInt 按十进制数字算，二进制缓冲和它的视图按字节数算)。
// 里面有普通对象、数组、二进制缓冲、基本类型以外的值(Map、Set、Error 等，内容不进 JSON)或循环引用时算不出，返回 null
export function plainSize(value: unknown): number | null {
  let binary = 0;
  try {
    const json = JSON.stringify([value], (_key, v: unknown) => {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
      if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
        binary += v.byteLength;
        return null;
      }
      const proto: unknown = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new TypeError('不是普通对象');
      return v;
    });
    // 不算包在外面的一对方括号
    return Buffer.byteLength(json) - 2 + binary;
  } catch {
    return null;
  }
}
