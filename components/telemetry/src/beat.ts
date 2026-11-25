// 心跳：程序开着时隔一段时间发一条，接收端按设备标识去重得到在线数和活跃数。

export const FIRST_MS = 60_000;    // 开始发送后隔多久发第一条(毫秒)
export const EVERY_MS = 600_000;   // 之后每隔多久发一条(毫秒)
const SEND_TIMEOUT_MS = 10_000;    // 一次发送最多等这么久(毫秒)

// 一条心跳
export interface Beat {
  v: 1;              // 记录格式的版本
  device: string;    // 设备标识
  session: string;   // 会话标识：程序这次运行的随机值
  app: string;       // 程序版本
}

// 按间隔调 send；返回停下的函数
export function startBeats(send: () => void): () => void {
  let every: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    send();
    every = setInterval(send, EVERY_MS);
  }, FIRST_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

// 把一条心跳 POST 给接收地址(JSON 数组，里面一条记录)；没收下时抛出
export async function postBeat(endpoint: string, beat: Beat): Promise<void> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([beat]),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
}
