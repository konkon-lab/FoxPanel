// 面板页面「是不是正被显示」：宿主每次变了发来一次，页面里登记的回调都得到；后登记的回调按最近一次的值先调一次。
// 不导入 electron，窄 preload(page.ts)把宿主发来的值交给 receive。

export interface VisibleState {
  receive(on: unknown): void;                // 宿主发来的值：只有 true 算在显示
  watch(fn: (on: boolean) => void): void;    // 登记回调，马上按最近一次的值调一次
}

// 宿主还没发来时算在显示
export function visibleState(): VisibleState {
  let visible = true;
  const listeners: ((on: boolean) => void)[] = [];
  return {
    receive(on) {
      visible = on === true;
      for (const fn of listeners) fn(visible);
    },
    watch(fn) {
      listeners.push(fn);
      fn(visible);
    },
  };
}
