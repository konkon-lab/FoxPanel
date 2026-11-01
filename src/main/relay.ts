// 远程服务的通道：一个主进程组件登记成某个名字的提供方，发布一份状态、接收调用；别的组件进程和页面订阅状态、发调用。
// 核心不看状态和参数的内容，只管哪个提供方生效、谁订阅了、调用是谁发的；每个登记生效没有也告诉提供方自己。

import { POLICY, type Ipc } from './ipc.ts';
import { plainSize } from './payload.ts';
import { usesRemote, type Senders } from './senders.ts';
import type { RelayRequest, ToProcess } from '../shared/host-protocol.ts';
import { IPC, type Caller, type Log } from '../shared/types.ts';

export const CALL_MS = 15_000;       // 等结果的调用最长等这么久(毫秒)
export const ARGS_MAX = 64 * 1024;   // 一次调用的参数存成 JSON 的大小上限(字节；二进制缓冲按字节数加上)
const WARN_MS = 10_000;              // 同一个组件发往同一个服务的调用因为同一个原因被拒，最少隔这么久写一行警告(毫秒)

// 这里用到的组件进程接口
export interface RelayHost {
  post(m: ToProcess): void;
  reply(req: number, value: unknown, error?: string): void;   // 回这个进程带 req 的请求；error 有值时按失败回
  runs(id: string): boolean;                                  // 这个进程里有这个组件
}

export interface RelayDeps {
  providers(name: string): readonly string[];                 // 开着的组件里清单 provides 有这个名字的，按组件顺序；排最前的那个生效
  senders: Senders;                                           // 各页面够得着哪些远程服务
  toPage(id: number, name: string, state: unknown): void;     // 把状态发给一个页面(webContents 的 id)
  log: Log;
  now?(): number;   // 当前时间(毫秒)，警告的限频用；不给时用系统时钟
}

// 一个登记了的提供方：所在的进程、组件 id、它最近发布的状态(没发布过为 null)、告诉过它的生效没有(没告诉过为 null)
interface Provider {
  host: RelayHost;
  component: string;
  state: unknown;
  told: boolean | null;
}

// 一次调用的结果交给它；error 有值时是失败
type Done = (value: unknown, error?: string) => void;

// 等提供方回结果的一次调用
interface Pending {
  provider: Provider;
  timer: NodeJS.Timeout;
  done: Done;
}

// 方法名的格式：字母、数字、下划线、$，不以数字开头，最长 64 个字符
const METHOD = /^[A-Za-z_$][\w$]{0,63}$/;

export class ServiceRelay {
  private readonly deps: RelayDeps;
  private readonly registered = new Map<string, Provider[]>();        // 服务名 → 登记了的提供方(生效的和排在后面等着的)
  private readonly serving = new Map<string, Provider>();             // 服务名 → 生效的提供方
  private readonly hostUsers = new Map<string, Set<RelayHost>>();     // 服务名 → 订阅了的组件进程
  private readonly pageUsers = new Map<string, Set<number>>();        // 服务名 → 订阅了的页面(webContents 的 id)
  private readonly pending = new Map<number, Pending>();              // 请求号 → 等结果的调用
  private readonly warned = new Map<string, number>();                // 警告的内容 → 上次写它的时间
  private nextReq = 0;

  constructor(deps: RelayDeps) {
    this.deps = deps;
  }

  // name 的状态；没有生效的提供方、或它还没发布过时为 null
  state(name: string): unknown {
    return this.serving.get(name)?.state ?? null;
  }

  // 组件变了(开关、顺序、装卸)：每个名字重新认生效的提供方
  sync(): void {
    for (const name of [...this.registered.keys()]) this.settle(name);
  }

  // 认 name 生效的提供方：登记了的里面，组件是同名提供者里排最前的那个；它没登记时这个名字没有提供方。
  // 换了提供方时，等前一个回结果的调用按失败回，状态变了就发给订阅方；各个登记生效没有告诉它所在的进程
  private settle(name: string): void {
    const first = this.deps.providers(name)[0];
    const old = this.serving.get(name);
    const next = this.registered.get(name)?.find(p => p.component === first);
    if (next !== old) {
      const before = this.state(name);
      if (next) this.serving.set(name, next);
      else this.serving.delete(name);
      if (old) this.fail(old, `提供 ${name} 的组件停了`);
      if (this.state(name) !== before) this.broadcast(name);
    }
    this.announce(name);
  }

  // name 的每个登记生效没有，和上次告诉它的不一样时发给它所在的进程(只发给那一个进程)；变成等着的排在变成生效的前面发
  private announce(name: string): void {
    const serving = this.serving.get(name);
    const changed = (this.registered.get(name) ?? []).filter(p => p.told !== (p === serving));
    for (const p of [...changed.filter(p => p !== serving), ...changed.filter(p => p === serving)]) {
      p.told = p === serving;
      p.host.post({ t: 'rvActive', name, component: p.component, on: p.told });
    }
  }

  // 等这个提供方回结果的调用都按失败回
  private fail(provider: Provider, error: string): void {
    for (const [req, p] of [...this.pending]) {
      if (p.provider !== provider) continue;
      this.pending.delete(req);
      clearTimeout(p.timer);
      p.done(null, error);
    }
  }

  // name 的状态发给订阅了的组件进程和页面；页面关了、或它加载的组件够不着这个名字时，清掉它的订阅
  private broadcast(name: string): void {
    const state = this.state(name);
    for (const host of this.hostUsers.get(name) ?? []) host.post({ t: 'rvState', name, state });
    const pages = this.pageUsers.get(name);
    for (const id of pages ?? []) {
      const info = this.deps.senders.get(id);
      if (info && usesRemote(info, name)) this.deps.toPage(id, name, state);
      else pages?.delete(id);
    }
  }

  // 写一行警告；同样的内容 WARN_MS 内只写一次
  private warn(text: string, source: string): void {
    const now = (this.deps.now ?? Date.now)();
    const key = `${source} ${text}`;
    const last = this.warned.get(key);
    if (last !== undefined && now - last < WARN_MS) return;
    this.warned.set(key, now);
    this.deps.log(text, 'warn', source);
  }

  // 登记提供方：组件要在这个进程里、开着、清单 provides 里有这个名字，否则不登记并写警告。
  // 同名提供者里它不是排最前的那个时先等着，排在前面的都停了才生效；登记上了就把生效没有告诉它一次
  private serve(component: string, name: string, host: RelayHost): void {
    const all = this.deps.providers(name);
    if (!host.runs(component) || !all.includes(component)) {
      this.deps.log(`cannot serve ${name}: the component is off or does not list it in provides`, 'warn', component);
      return;
    }
    const others = this.registered.get(name)?.filter(p => p.component !== component) ?? [];
    this.registered.set(name, [...others, { host, component, state: null, told: null }]);
    if (all[0] !== component) this.deps.log(`${name} is served by ${all[0] ?? ''}; this component takes over when that one stops`, 'warn', component);
    this.settle(name);
  }

  // host 这个进程里 component 对 name 的登记；没有时为 undefined
  private find(component: string, name: string, host: RelayHost): Provider | undefined {
    return this.registered.get(name)?.find(p => p.component === component && p.host === host);
  }

  // 撤掉一个登记
  private close(component: string, name: string, host: RelayHost): void {
    const gone = this.find(component, name, host);
    if (!gone) return;
    const rest = this.registered.get(name)?.filter(p => p !== gone) ?? [];
    if (rest.length) this.registered.set(name, rest);
    else this.registered.delete(name);
    this.settle(name);
  }

  // 提供方发布状态：记下来；它是生效的那个时发给订阅方
  private publish(component: string, name: string, state: unknown, host: RelayHost): void {
    const p = this.find(component, name, host);
    if (!p) return;
    p.state = state;
    if (this.serving.get(name) === p) this.broadcast(name);
  }

  // 组件进程订阅 / 退订 name 的状态；订阅时把当前状态发给它
  private use(name: string, on: boolean, host: RelayHost): void {
    if (!on) {
      this.hostUsers.get(name)?.delete(host);
      return;
    }
    const users = this.hostUsers.get(name) ?? new Set();
    this.hostUsers.set(name, users.add(host));
    host.post({ t: 'rvState', name, state: this.state(name) });
  }

  // 一次调用交给 name 生效的提供方，带上调用者。done 不为 null 时等结果：方法名不合格、没有提供方、参数过大或算不出大小、
  // 提供方停了、CALL_MS 内没回，都按失败回；为 null 时不等，按到达的先后交给提供方，交不出去就丢掉
  private call(name: unknown, method: unknown, args: unknown, caller: Caller, done: Done | null): void {
    if (typeof name !== 'string' || typeof method !== 'string' || !Array.isArray(args)) return void done?.(null, '参数不对');
    if (!METHOD.test(method)) {
      this.warn(`call to ${name} refused: bad method name`, caller.component);
      return void done?.(null, '参数不对');
    }
    const provider = this.serving.get(name);
    if (!provider) return void done?.(null, `没有提供 ${name} 的组件`);
    const list = args as unknown[];
    const size = plainSize(list);
    if (size === null) {
      this.warn(`call to ${name} refused: arguments hold something other than plain data`, caller.component);
      return void done?.(null, '参数里有普通数据以外的值');
    }
    if (size > ARGS_MAX) {
      this.warn(`call to ${name} refused: arguments are over ${ARGS_MAX / 1024} KB`, caller.component);
      return void done?.(null, `参数超过 ${ARGS_MAX / 1024} KB`);
    }
    const invoke = { t: 'rvInvoke' as const, name, component: provider.component, method, args: list, caller };
    if (!done) return provider.host.post(invoke);
    const req = ++this.nextReq;
    const timer = setTimeout(() => {
      this.pending.delete(req);
      done(null, `调用 ${name}.${method} 超时`);
    }, CALL_MS);
    this.pending.set(req, { provider, timer, done });
    provider.host.post({ ...invoke, req });
  }

  // 提供方回了一次调用的结果；不是等着的那个进程回的不算
  private result(req: number, value: unknown, error: unknown, host: RelayHost): void {
    const p = this.pending.get(req);
    if (!p || p.provider.host !== host) return;
    this.pending.delete(req);
    clearTimeout(p.timer);
    if (typeof error === 'string') p.done(null, error);
    else p.done(value);
  }

  // 组件进程发来的消息
  message(m: RelayRequest, host: RelayHost): void {
    switch (m.t) {
      case 'rvServe':
        if (typeof m.component === 'string' && typeof m.name === 'string') this.serve(m.component, m.name, host);
        return;
      case 'rvClose': return this.close(m.component, m.name, host);
      case 'rvState': return this.publish(m.component, m.name, m.state, host);
      case 'rvUse':
        if (typeof m.name === 'string') this.use(m.name, m.on === true, host);
        return;
      case 'rvCall': {
        const req = m.req;
        const done = typeof req === 'number' ? (value: unknown, error?: string): void => host.reply(req, value, error) : null;
        if (typeof m.component !== 'string' || !host.runs(m.component)) return void done?.(null, '参数不对');
        return this.call(m.name, m.method, m.args, { component: m.component, where: 'process' }, done);
      }
      case 'rvResult': return this.result(m.req, m.value, m.error, host);
    }
  }

  // 核心替一个页面发的不等结果的调用(面板页面请显示方收起自己)；交不出去就丢掉
  tell(name: string, method: string, args: unknown[], caller: Caller): void {
    this.call(name, method, args, caller, null);
  }

  // 一个组件进程停了或退出了：清掉它的订阅和登记；它是生效的提供方的名字，状态变 null，等它回结果的调用按失败回
  hostGone(host: RelayHost): void {
    for (const users of this.hostUsers.values()) users.delete(host);
    for (const [name, list] of [...this.registered]) {
      const rest = list.filter(p => p.host !== host);
      if (rest.length === list.length) continue;
      if (rest.length) this.registered.set(name, rest);
      else this.registered.delete(name);
      this.settle(name);
    }
  }

  // 页面订阅 / 退订 name 的状态；订阅时把当前状态发给它
  private pageUse(id: number, name: string, on: boolean): void {
    if (!on) {
      this.pageUsers.get(name)?.delete(id);
      return;
    }
    const users = this.pageUsers.get(name) ?? new Set();
    this.pageUsers.set(name, users.add(id));
    this.deps.toPage(id, name, this.state(name));
  }

  // 页面一侧的通道经 ipc 注册(谁能调见 POLICY)；服务名不在这一页够得着的远程服务里的调用，到这里之前已经被拒
  registerIpc(ipc: Ipc): void {
    ipc.handle(IPC.relayUse, POLICY.relayUse, (e, name, on) => {
      if (typeof name === 'string') this.pageUse(e.sender.id, name, on === true);
    });
    ipc.handle(IPC.relayCall, POLICY.relayCall, (e, name, method, args, wait) => {
      const info = this.deps.senders.get(e.sender.id);
      if (!info || info.kind === 'window') throw new Error('参数不对');
      // 面板页面发的带上面板 id；媒体页面一页里的组件分不开，不带
      const caller: Caller = info.kind === 'panel' ? { component: info.panel, where: 'panel' } : { component: '', where: info.kind };
      if (wait !== true) return this.call(name, method, args, caller, null);
      return new Promise((resolve, reject) => {
        this.call(name, method, args, caller, (value, error) => (error === undefined ? resolve(value) : reject(new Error(error))));
      });
    });
  }
}
