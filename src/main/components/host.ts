// 组件进程的宿主端：启动、组件列表变了时让进程只换变了的组件、崩溃后自动重启(1 分钟内连崩 3 次就停)；转发应用信息、发送、听写、存储、总线、日志；
// 收组件上报的状态栏项；远程服务、面板页面的消息和组件的通用请求交给宿主对应的部分。

import { utilityProcess, type UtilityProcess } from 'electron';
import type { AppInfo, AppRequest, FromProcess, HostComponent, OutputInfo, OutputPayload, PanelRequest, RelayRequest, ToProcess } from '../../shared/host-protocol.ts';
import type { HostStatus, Log, LogEntry, PanelInfo, StatusItem } from '../../shared/types.ts';
import { parseStatusItem } from '../../shared/status.ts';
import { errorText } from '../../shared/util.ts';
import type { ComponentStorage } from './storage.ts';

const RESTART_MS = 1000;          // 进程意外退出后等这么久重启(毫秒)
const CRASH_WINDOW_MS = 60_000;   // 连续崩溃按这段时间内的退出次数算(毫秒)
const CRASH_MAX = 3;              // CRASH_WINDOW_MS 内退出满这么多次就停下，等手动重启
const TRANSLATE_MS = 15_000;      // 一次翻译最长等这么久(毫秒)

export interface HostDeps {
  file: string;            // 组件进程入口(dist/component-host.js)
  name: string;            // 进程名(任务管理器里显示)
  shared: Record<string, string>;   // 组件 import 时指向宿主那份的模块：名字 → 地址(file://)，如 cordis、koffi
  dataDir: string;         // 数据文件夹
  appDir: string;          // 程序目录(vendor 等随程序带的文件在这里)
  storage: ComponentStorage;
  log: Log;
  bus(channel: string, data: unknown): void;           // 组件进程发出的总线消息 → 页面
  changed(): void;                                     // 输出、听写、状态、加载错误变了
  logs(): LogEntry[];                                  // 内存里已有的日志行(进程启动时补发)
  gone(host: ComponentHost): void;                     // 这个进程停了或退出了
  panels(m: PanelRequest, host: ComponentHost): void;           // 显示方对面板页面的操作
  panelList(): PanelInfo[];                                     // 当前的面板目录(进程启动时带给它)
  info(): AppInfo;                                              // 当前的应用信息(进程启动时带给它)
  relay(m: RelayRequest, host: ComponentHost): void;            // 远程服务的消息
  request(m: AppRequest, host: ComponentHost): void;            // 组件要宿主做的事(带 req 的用 host.reply 回)
}

export class ComponentHost {
  private readonly deps: HostDeps;
  private proc: UtilityProcess | null = null;
  private components: HostComponent[] = [];
  private signature = '';
  private crashes: number[] = [];
  private restartTimer: NodeJS.Timeout | undefined;
  outputs: OutputInfo[] = [];
  inputs: string[] = [];
  translator = false;
  private translating = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private nextReq = 0;
  errors = new Map<string, string>();   // 组件 id → 加载错误
  items = new Map<string, StatusItem>(); // 组件 id → 状态栏项
  status: HostStatus = 'idle';

  constructor(deps: HostDeps) {
    this.deps = deps;
  }

  // 要加载的组件变了(含设置、入口文件修改时间)：进程在跑时交给它只换变了的，没在跑时启动；没有组件时停掉
  load(components: HostComponent[]): void {
    const sig = JSON.stringify(components);
    if (sig === this.signature && (this.proc || this.status === 'crashed')) return;
    this.signature = sig;
    this.components = components;
    if (this.proc && components.length) {
      const ids = new Set(components.map(c => c.id));
      for (const id of [...this.errors.keys()]) if (!ids.has(id)) this.errors.delete(id);
      for (const id of [...this.items.keys()]) if (!ids.has(id)) this.items.delete(id);
      this.post({ t: 'apply', components });
      this.deps.changed();
      return;
    }
    this.crashes = [];
    this.restart();
  }

  // 起进程，在跑的停掉；没有组件时只停。load() 和连续崩溃停下后的手动重启都走这里
  restart(): void {
    clearTimeout(this.restartTimer);
    this.kill();
    this.errors.clear();
    if (!this.components.length) {
      this.status = 'idle';
      this.deps.changed();
      return;
    }
    this.spawn();
  }

  stop(): void {
    clearTimeout(this.restartTimer);
    this.kill();
  }

  // 进程没了：等着的翻译都按失败处理(宿主用原文)，它注册的输出、听写、翻译、状态栏项清掉，通知宿主
  private detach(): void {
    this.proc = null;
    for (const p of this.translating.values()) p.reject(new Error('组件进程已退出'));
    this.translating.clear();
    this.outputs = [];
    this.inputs = [];
    this.translator = false;
    this.items.clear();
    this.deps.gone(this);
  }

  private kill(): void {
    const p = this.proc;
    if (!p) return;
    this.detach();
    p.kill();
  }

  private spawn(): void {
    const p = utilityProcess.fork(this.deps.file, [], { serviceName: this.deps.name, stdio: 'pipe' });
    this.proc = p;
    this.status = 'running';
    p.stdout?.on('data', (b: Buffer) => this.deps.log(`component host: ${b.toString().trimEnd()}`));
    p.stderr?.on('data', (b: Buffer) => this.deps.log(`component host: ${b.toString().trimEnd()}`, 'warn'));
    p.on('message', (m: FromProcess) => this.onMessage(m));
    // 意外退出(kill() 停掉的进程在这之前已经不是 this.proc)
    p.on('exit', code => {
      if (this.proc !== p) return;
      this.detach();
      const now = Date.now();
      this.crashes = [...this.crashes.filter(t => now - t < CRASH_WINDOW_MS), now];
      if (this.crashes.length >= CRASH_MAX) {
        this.status = 'crashed';
        this.deps.log(`component host exited ${CRASH_MAX} times in a minute, not restarting`, 'error');
      } else {
        this.status = 'restarting';
        this.deps.log(`component host exited (${code}), restarting in ${RESTART_MS / 1000}s`, 'warn');
        this.restartTimer = setTimeout(() => this.spawn(), RESTART_MS);
      }
      this.deps.changed();
    });
    this.post({
      t: 'load', components: this.components, info: this.deps.info(), panels: this.deps.panelList(),
      shared: this.deps.shared, dataDir: this.deps.dataDir, appDir: this.deps.appDir,
    });
    this.post({ t: 'logs', lines: this.deps.logs() });
  }

  // 组件进程的 pid(没在跑时 undefined)
  get pid(): number | undefined {
    return this.proc?.pid;
  }

  // 这个进程要加载的组件里有这个 id
  runs(id: string): boolean {
    return this.components.some(c => c.id === id);
  }

  // 发给组件进程(进程没在跑时丢掉)
  post(m: ToProcess): void {
    this.proc?.postMessage(m);
  }

  // 回复组件进程带 req 的请求；error 有值时按失败回
  reply(req: number, value: unknown, error?: string): void {
    this.post(error === undefined ? { t: 'reply', req, value } : { t: 'reply', req, value: null, error });
  }

  private onMessage(m: FromProcess): void {
    switch (m.t) {
      case 'outputs':
        this.outputs = m.outputs;
        this.inputs = m.inputs;
        this.translator = m.translator;
        return this.deps.changed();
      case 'loaded':
        if (m.error) {
          this.errors.set(m.id, m.error);
          this.deps.log(`load failed: ${m.error}`, 'error', m.id);
        } else this.errors.delete(m.id);
        return this.deps.changed();
      case 'storage': {
        try {
          this.reply(m.req, this.deps.storage.call(m.id, m.call));
        } catch (e) {
          this.reply(m.req, null, errorText(e));
        }
        return;
      }
      case 'bus': return this.deps.bus(m.channel, m.data);
      case 'log': return this.deps.log(m.text, m.level ?? 'info', m.id);
      case 'status': {
        const item = parseStatusItem(m.item);
        if (item) this.items.set(m.id, item);
        else this.items.delete(m.id);
        return;
      }
      case 'pnOpen': case 'pnClose': case 'pnRelease': case 'pnInput': case 'pnPaint': case 'pnFps':
        return this.deps.panels(m, this);
      case 'rvServe': case 'rvClose': case 'rvState': case 'rvUse': case 'rvCall': case 'rvResult':
        return this.deps.relay(m, this);
      case 'outSend': case 'outTyping': case 'outClear': case 'inDictate': case 'trAsk': case 'setOn': case 'clipRead': case 'clipWrite':
        return this.deps.request(m, this);
      case 'translated': {
        const p = this.translating.get(m.req);
        this.translating.delete(m.req);
        if (m.error !== undefined) p?.reject(new Error(m.error));
        else p?.resolve(m.text ?? '');
      }
    }
  }

  // 发给开着的输出(只在 ids 里的)；live = 自动送出 / PIN，只发给 live 的；返回收到的组件 id
  send(payload: OutputPayload, live: boolean, ids: readonly string[]): string[] {
    const to = this.outputs.filter(o => ids.includes(o.id) && (!live || o.live)).map(o => o.id);
    if (to.length) this.post({ t: 'send', payload, to });
    return to;
  }

  // 交给翻译组件；没有翻译组件时原样返回，出错或超时抛出异常
  translate(text: string): Promise<string> {
    if (!this.translator || !this.proc) return Promise.resolve(text);
    const req = ++this.nextReq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.translating.delete(req);
        reject(new Error('翻译超时'));
      }, TRANSLATE_MS);
      this.translating.set(req, {
        resolve: t => { clearTimeout(timer); resolve(t); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this.post({ t: 'translate', req, text });
    });
  }

  // ids 里有能显示「正在输入」的输出
  hasTyping(ids: readonly string[]): boolean {
    return this.outputs.some(o => o.typing && ids.includes(o.id));
  }

  typing(on: boolean): void {
    this.post({ t: 'typing', on });
  }

  clear(): void {
    this.post({ t: 'clear' });
  }

  // 开关听写；没有接听写的输入源时不开
  dictate(on: boolean): void {
    if (on && !this.inputs.length) return;
    this.post({ t: 'dictate', on });
  }

  // 应用信息变了
  info(info: AppInfo): void {
    this.post({ t: 'info', info });
  }

  // 面板目录变了
  panels(list: PanelInfo[]): void {
    this.post({ t: 'pnList', panels: list });
  }

  // 新的日志行
  logs(lines: LogEntry[]): void {
    this.post({ t: 'logs', lines });
  }

  bus(channel: string, data: unknown): void {
    this.post({ t: 'bus', channel, data });
  }
}
