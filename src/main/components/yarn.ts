// 组件项目(数据文件夹的 components/，见 docs/market.md)：package.json 的 dependencies 是从 npm 装的组件。
// 在 Node 子进程里跑自带的 yarn.cjs(程序里是 Electron 的 utilityProcess)；一次只跑一个任务，失败时 package.json 和 yarn.lock 回到跑之前。

import fs from 'node:fs';
import path from 'node:path';
import type { Log } from '../../shared/types.ts';
import { isObject } from '../../shared/util.ts';

const TIMEOUT_MS = 10 * 60_000;   // 一个 yarn 任务最长跑这么久(毫秒)
const TAIL = 20;                  // 出错时报出最后这么多行输出
const SOURCE = 'market';          // 运行日志里的来源
// 输出里说明失败原因的行：yarn 的 YN0001(异常)、YN0035(网络请求失败)、YN0082(没有符合的版本)、YN0016(远端没有这个包)，和带 Error 的行
const ERROR_LINE = /YN0001|YN0035|YN0082|YN0016|Error/;

export interface YarnDeps {
  dir: string;                    // 组件项目目录
  yarn: string;                   // yarn.cjs 的路径
  fork: YarnFork;                 // 起 Node 子进程跑脚本
  registry(): string;             // 下载组件的仓库地址
  scripts(): boolean;             // 是否执行包里的安装脚本
  log: Log;
}

// 起一个 Node 子进程跑脚本：输出接成管道，退出时给退出码
export type YarnFork = (script: string, args: readonly string[], opts: { cwd: string; env: Record<string, string | undefined> }) => YarnProcess;
export interface YarnProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(): boolean;
  once(event: 'exit', fn: (code: number | null) => void): unknown;
}

const PROJECT = 'foxpanel-components';   // 组件项目 package.json 的 name

// 仓库是 http 地址时 yarn 要把它的主机列进白名单才肯连
function httpHost(registry: string): string[] {
  if (!registry.startsWith('http://')) return [];
  try {
    return ['unsafeHttpWhitelist:', `  - ${JSON.stringify(new URL(registry).hostname)}`];
  } catch {
    return [];
  }
}

export class Yarn {
  private readonly deps: YarnDeps;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: YarnDeps) {
    this.deps = deps;
  }

  // 项目里的组件包：包名 → 版本范围
  dependencies(): Record<string, string> {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(this.deps.dir, 'package.json'), 'utf8'));
      const deps = isObject(raw) ? raw['dependencies'] : undefined;
      if (!isObject(deps)) return {};
      return Object.fromEntries(Object.entries(deps).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch {
      return {};
    }
  }

  // 写项目文件：package.json(保留 dependencies)、.yarnrc.yml(仓库、安装脚本开关、缓存放在项目里)、空的 yarn.lock
  prepare(): void {
    const dir = this.deps.dir;
    fs.mkdirSync(dir, { recursive: true });
    // type: module：组件文件夹里的入口文件是 ES 模块
    const pkg = { name: PROJECT, private: true, type: 'module', dependencies: this.dependencies() };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    const rc = [
      'nodeLinker: node-modules',
      `enableScripts: ${this.deps.scripts()}`,
      'enableTelemetry: false',
      'enableGlobalCache: false',
      'cacheFolder: ./.yarn/cache',
      'globalFolder: ./.yarn/global',
      // 不报宿主 SDK 没装：宿主版本范围在装之前由市场检查
      'logFilters:',
      '  - code: YN0002',
      '    level: discard',
      '  - code: YN0086',
      '    level: discard',
      `npmRegistryServer: ${JSON.stringify(this.deps.registry())}`,
      ...httpHost(this.deps.registry()),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, '.yarnrc.yml'), rc);
    const lock = path.join(dir, 'yarn.lock');
    if (!fs.existsSync(lock)) fs.writeFileSync(lock, '');
  }

  // 排队跑一条 yarn 命令；失败时抛出带最后几行输出的错误
  run(args: readonly string[]): Promise<void> {
    const next = this.queue.then(() => this.exec(args));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async exec(args: readonly string[]): Promise<void> {
    this.prepare();
    const dir = this.deps.dir;
    const backup = ['package.json', 'yarn.lock'].map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')] as const);
    this.deps.log(`yarn ${args.join(' ')}`, 'info', SOURCE);
    try {
      await this.spawn(args);
    } catch (e) {
      for (const [f, text] of backup) fs.writeFileSync(path.join(dir, f), text);
      throw e;
    }
  }

  private spawn(args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const env: Record<string, string | undefined> = { ...process.env, YARN_ENABLE_PROGRESS_BARS: '0', YARN_ENABLE_COLORS: '0', YARN_ENABLE_HYPERLINKS: '0' };
      // 执行安装脚本时，脚本里的 node 是 yarn 指向的程序本体，要靠这个变量当 node 跑
      if (this.deps.scripts()) env['ELECTRON_RUN_AS_NODE'] = '1';
      let p: YarnProcess;
      try {
        p = this.deps.fork(this.deps.yarn, args, { cwd: this.deps.dir, env });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const tail: string[] = [];
      let rest = '';
      const onData = (chunk: Buffer): void => {
        const lines = (rest + chunk.toString('utf8')).split(/\r?\n/);
        rest = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          this.deps.log(line, /YN\d{4}: .*(error|Error)|^Usage Error/.test(line) ? 'warn' : 'info', SOURCE);
          tail.push(line);
          if (tail.length > TAIL) tail.shift();
        }
      };
      p.stdout?.on('data', onData);
      p.stderr?.on('data', onData);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        p.kill();
      }, TIMEOUT_MS);
      p.once('exit', code => {
        clearTimeout(timer);
        if (rest.trim()) tail.push(rest);
        if (timedOut) reject(new Error(`yarn 跑了超过 ${TIMEOUT_MS / 60_000} 分钟，已停止`));
        else if (code === 0) resolve();
        else reject(new Error(tail.filter(l => ERROR_LINE.test(l)).join('\n') || tail.join('\n') || `yarn 退出码 ${code}`));
      });
    });
  }
}
