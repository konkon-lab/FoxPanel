// 几个组件进程合在一起用：大多数主进程组件共用一个进程，清单写了 process: "own" 的组件各自一个进程
// (崩了只重启它)；组件变了时各进程只换变了的组件，不重启进程。对外和单个 ComponentHost 一样：发送、听写、翻译、总线、日志、应用信息、面板目录、状态栏项都汇总或分发。

import { ComponentHost, type HostDeps } from './host.ts';
import type { AppInfo, HostComponent, OutputInfo, OutputPayload } from '../../shared/host-protocol.ts';
import type { HostStatus, LogEntry, PanelInfo, StatusItem } from '../../shared/types.ts';

const SHARED = '';   // 共用进程的键；独立进程的键是组件 id
// 几个进程的状态合成一个：取排在最前面的
const WORST: readonly HostStatus[] = ['crashed', 'restarting', 'running', 'idle'];

export interface HostsComponent extends HostComponent {
  own: boolean;   // 独立进程
}

// 各进程共用的依赖；进程名由 ComponentHosts 按进程起
export type HostsDeps = Omit<HostDeps, 'name'>;

export class ComponentHosts {
  private readonly deps: HostsDeps;
  private readonly hosts = new Map<string, ComponentHost>();
  private order: string[] = [];                     // 计划里的组件 id，按组件顺序
  private dictating: ComponentHost | null = null;   // 正在听写的进程

  constructor(deps: HostsDeps) {
    this.deps = deps;
  }

  // 一个进程：它发出的总线消息也转给其他进程
  private make(key: string): ComponentHost {
    const host = new ComponentHost({
      ...this.deps,
      name: key === SHARED ? 'FoxPanel 组件' : `FoxPanel ${key}`,
      bus: (channel, data) => {
        for (const h of this.hosts.values()) if (h !== host) h.bus(channel, data);
        this.deps.bus(channel, data);
      },
    });
    return host;
  }

  // 按计划分进程；计划里没有的进程停掉。停掉的进程自己不上报，它带走的输出、听写、状态由这里通知
  load(list: readonly HostsComponent[]): void {
    this.order = list.map(c => c.id);
    const groups = new Map<string, HostComponent[]>([[SHARED, []]]);
    for (const { own, ...c } of list) {
      const key = own ? c.id : SHARED;
      groups.set(key, [...groups.get(key) ?? [], c]);
    }
    let stopped = false;
    for (const [key, h] of this.hosts) {
      if (groups.has(key)) continue;
      h.stop();
      this.hosts.delete(key);
      stopped = true;
    }
    for (const [key, comps] of groups) {
      let h = this.hosts.get(key);
      if (!h) this.hosts.set(key, h = this.make(key));
      h.load(comps);
    }
    if (stopped) this.deps.changed();
  }

  private get all(): ComponentHost[] {
    return [...this.hosts.values()];
  }

  get status(): HostStatus {
    const list = this.all.map(h => h.status);
    return WORST.find(s => list.includes(s)) ?? 'idle';
  }

  get errors(): ReadonlyMap<string, string> {
    return new Map(this.all.flatMap(h => [...h.errors]));
  }

  get items(): ReadonlyMap<string, StatusItem> {
    return new Map(this.all.flatMap(h => [...h.items]));
  }

  get outputs(): OutputInfo[] {
    return this.all.flatMap(h => h.outputs);
  }

  get inputs(): string[] {
    return this.all.flatMap(h => h.inputs);
  }

  get translator(): boolean {
    return this.all.some(h => h.translator);
  }

  // 重新启动崩溃停下的进程
  restart(): void {
    for (const h of this.all) if (h.status === 'crashed') h.restart();
  }

  stop(): void {
    for (const h of this.all) h.stop();
  }

  send(payload: OutputPayload, live: boolean, ids: readonly string[]): string[] {
    return this.all.flatMap(h => h.send(payload, live, ids));
  }

  hasTyping(ids: readonly string[]): boolean {
    return this.all.some(h => h.hasTyping(ids));
  }

  typing(on: boolean): void {
    for (const h of this.all) h.typing(on);
  }

  clear(): void {
    for (const h of this.all) h.clear();
  }

  // 接了听写的输入源里组件顺序最前的那个所在的进程
  private inputHost(): ComponentHost | undefined {
    const all = this.all;
    for (const id of this.order) {
      const h = all.find(x => x.inputs.includes(id));
      if (h) return h;
    }
    return undefined;
  }

  // 听写交给组件顺序最前的输入源所在的进程(进程里再按组件顺序选)；停止时交给开始的那个
  dictate(on: boolean): void {
    if (!on) {
      this.dictating?.dictate(false);
      this.dictating = null;
      return;
    }
    const h = this.inputHost();
    if (!h) return;
    this.dictating = h;
    h.dictate(true);
  }

  translate(text: string): Promise<string> {
    const h = this.all.find(x => x.translator);
    return h ? h.translate(text) : Promise.resolve(text);
  }

  info(info: AppInfo): void {
    for (const h of this.all) h.info(info);
  }

  panels(list: PanelInfo[]): void {
    for (const h of this.all) h.panels(list);
  }

  logs(lines: LogEntry[]): void {
    for (const h of this.all) h.logs(lines);
  }

  bus(channel: string, data: unknown): void {
    for (const h of this.all) h.bus(channel, data);
  }
}
