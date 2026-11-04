// 一个组件占用的东西：卸载时逐个放掉(监听、注册的输出 / 听写 / 翻译、面板页面、状态栏项、远程服务的登记和订阅)
export class Owned {
  private readonly list = new Set<() => unknown>();
  // 记下一项，返回的函数把它拿掉并放掉
  add(fn: () => unknown): () => void {
    this.list.add(fn);
    return () => {
      this.list.delete(fn);
      fn();
    };
  }
  // 记下一项；forget 只把它拿掉、不放(组件已经自己放掉了的)
  hold(fn: () => unknown): { forget(): void } {
    this.list.add(fn);
    return { forget: () => { this.list.delete(fn); } };
  }
  // 记着的项数
  get size(): number {
    return this.list.size;
  }
  // 按记下的相反次序逐项放掉；每一项经 run 调(出错由它处理)
  release(run: (fn: () => unknown) => void): void {
    for (const fn of [...this.list].reverse()) run(fn);
    this.list.clear();
  }
}
