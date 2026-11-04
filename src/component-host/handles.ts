// 宿主复制进本进程的 NT 句柄：没有组件收的帧由组件进程自己关掉句柄。

type CloseHandle = (handle: bigint) => boolean;

// kernel32 的 CloseHandle；koffi 在第一次用到时加载(只加载一次)，和组件 import 到的是同一份
let closeHandle: CloseHandle | null = null;
let loading: Promise<CloseHandle> | null = null;
function load(): Promise<CloseHandle> {
  loading ??= import('koffi').then(m => {
    closeHandle = m.default.load('kernel32.dll').func('bool __stdcall CloseHandle(uint64 h)') as CloseHandle;
    return closeHandle;
  });
  return loading;
}

// close 可以整个替换(测试里换成记录用的函数)
export const handles: { close(handle: bigint): void | Promise<void> } = {
  // 关掉一个句柄；句柄已经无效时不报错。库加载好了就当场关，还没加载好时返回的 promise 在关掉之后完成，加载不了时拒绝
  close(handle) {
    if (closeHandle) {
      closeHandle(handle);
      return;
    }
    return load().then(fn => { fn(handle); });
  },
};
