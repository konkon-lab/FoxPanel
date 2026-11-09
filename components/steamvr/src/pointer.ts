// 手柄指针的两个逐帧判断：要不要取指尖、圆点的显示状态。

const TIP_RETRY_MS = 1000;   // 手柄模型里取不到指尖时隔多久重取

// 要不要取指尖：设备序号和上一帧不同就取；序号有效(valid)却还没有指尖(hasTip)时，离最近一次取(tipAt)满 TIP_RETRY_MS 才取。时间都是 ms
export function needTip(prevDevice: number, device: number, valid: boolean, hasTip: boolean, now: number, tipAt: number): boolean {
  return device !== prevDevice || (!hasTip && valid && now - tipAt >= TIP_RETRY_MS);
}

// 圆点的显示状态：shown 是记着的状态，on 是这一帧要的；两者不同才调 apply(告诉 SteamVR)，apply 成功才记成 on，没成功的留到下一帧重试。返回要记下的状态
export function nextDotShown(shown: boolean, on: boolean, apply: (on: boolean) => boolean): boolean {
  if (shown === on) return shown;
  return apply(on) ? on : shown;
}
