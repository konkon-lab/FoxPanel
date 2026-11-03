// 在 utilityProcess 里跑 yarn.cjs。utilityProcess 的进程在脚本跑完后不会自己退出，
// 这里等 yarn 设好最终的退出码、除了输出管道和定时器没有别的活儿时，主动退出。
// 参数：yarn.cjs 的路径，后面是 yarn 的参数。

const POLL_MS = 50;          // 查一次 yarn 跑完没有的间隔
const MAX_WAIT_MS = 60_000;  // 设好退出码后最多再等这么久(删临时文件等)
const RUNNING = 42;          // yarn 运行期间占位的退出码，跑完时才是真正的值

const [yarnFile, ...args] = process.argv.slice(2);
if (!yarnFile) {
  process.stderr.write('yarn-host：缺少 yarn.cjs 的路径\n');
  process.exit(1);
}
// yarn 从 argv[1] 认自己的路径，从 argv[2] 起读参数
process.argv = [process.argv[0] ?? '', yarnFile, ...args];

const exitCode = (): number | undefined => {
  const v = process.exitCode;
  return v === undefined || v === null ? undefined : Number(v);
};

// yarn 设好最终退出码后，等到没有文件、网络操作，把输出写完再退出
let doneAt = 0;
function check(): void {
  const code = exitCode();
  if (code === undefined || code === RUNNING) {
    setTimeout(check, POLL_MS);
    return;
  }
  doneAt ||= Date.now();
  // 定时器不算：yarn 跑完后留下的定时器在普通 Node 里不拦着退出，剩下要等的只有删临时文件这类文件操作
  const busy = process.getActiveResourcesInfo().filter(r => r !== 'PipeWrap' && r !== 'TTYWrap' && r !== 'Timeout' && r !== 'Immediate');
  if (busy.length && Date.now() - doneAt < MAX_WAIT_MS) {
    setTimeout(check, POLL_MS);
    return;
  }
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
}

// yarn.cjs 加载时就开始跑
require(yarnFile);
setTimeout(check, POLL_MS);
