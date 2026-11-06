// 待交的值：只留最新的一个，停下 ms 毫秒后交给 deliver；没到时间要走时用 flush 立刻交。

export interface Settle<T> {
  push(value: T): void;   // 记下一个值，从头等 ms 毫秒
  flush(): void;          // 有待交的值就立刻交，没有就什么都不做
}

export function createSettle<T>(ms: number, deliver: (value: T) => void): Settle<T> {
  let waiting: { value: T; timer: ReturnType<typeof setTimeout> } | undefined;
  function flush(): void {
    if (!waiting) return;
    clearTimeout(waiting.timer);
    const { value } = waiting;
    waiting = undefined;
    deliver(value);
  }
  function push(value: T): void {
    clearTimeout(waiting?.timer);
    waiting = { value, timer: setTimeout(flush, ms) };
  }
  return { push, flush };
}
