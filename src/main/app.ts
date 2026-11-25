// 应用信息和主进程组件的通用请求：程序版本、界面语言、装着的组件、输出和听写的登记情况合成 AppInfo，变了就推给全部组件进程；
// 组件要的发送、「正在输入」、清除、听写、翻译、开关输出组件、读写系统剪贴板，交给登记了的进程、组件管理或系统去做。

import type { ComponentHost } from './components/host.ts';
import type { ComponentHosts } from './components/hosts.ts';
import type { AppInfo, AppRequest, OutputPayload } from '../shared/host-protocol.ts';
import type { Locale } from '../shared/types.ts';
import { errorText, isObject } from '../shared/util.ts';

// 这里用到的组件进程接口：全部进程合起来的输出、听写、翻译，和发请求的那个进程
type Hosts = Pick<ComponentHosts, 'outputs' | 'inputs' | 'send' | 'hasTyping' | 'typing' | 'clear' | 'dictate' | 'translate' | 'info'>;
type Asker = Pick<ComponentHost, 'reply'>;

export interface AppBridgeDeps {
  hosts(): Hosts;
  version: string;                         // 程序版本
  packaged: boolean;                       // 是安装包里的程序
  locale(): Locale;                        // 界面语言
  components(): AppInfo['components'];     // 装着的全部组件，按组件顺序
  setOn(id: string, on: boolean): void;    // 开关一个组件(和组件页的开关是同一个改动)
  clipboard: { readText(): Promise<string>; writeText(text: string): Promise<void> };   // 系统剪贴板
}

// 组件发来的一句(进程消息)收窄；格式不对时为 null
function readPayload(raw: unknown): OutputPayload | null {
  if (!isObject(raw)) return null;
  const { text, spoken, notify } = raw;
  return typeof text === 'string' && typeof spoken === 'string' ? { text, spoken, notify: notify === true } : null;
}

export class AppBridge {
  private readonly deps: AppBridgeDeps;
  private sig = '';   // 上次推给组件进程的 AppInfo(JSON)

  constructor(deps: AppBridgeDeps) {
    this.deps = deps;
  }

  // 当前的应用信息
  info(): AppInfo {
    const hosts = this.deps.hosts();
    const components = this.deps.components();
    const caps = new Map(hosts.outputs.map(o => [o.id, o]));
    const inputs = new Set(hosts.inputs);
    return {
      version: this.deps.version,
      packaged: this.deps.packaged,
      locale: this.deps.locale(),
      components,
      outputs: components.filter(c => c.kind === 'output').map(c => (
        { id: c.id, name: c.name, on: c.on, live: caps.get(c.id)?.live === true, typing: caps.get(c.id)?.typing === true }
      )),
      inputs: components.filter(c => inputs.has(c.id)).map(c => c.id),
      canDictate: inputs.size > 0,
    };
  }

  // 组件、输出和听写的登记、界面语言变了：应用信息推给全部组件进程(内容没变不推)
  refresh(): void {
    const info = this.info();
    const sig = JSON.stringify(info);
    if (sig === this.sig) return;
    this.sig = sig;
    this.deps.hosts().info(info);
  }

  // 正在用的输出组件
  private activeOutputs(): string[] {
    return this.deps.components().filter(c => c.kind === 'output' && c.active).map(c => c.id);
  }

  // 组件进程发来的请求；带 req 的用 host.reply 回
  message(m: AppRequest, host: Asker): void {
    const hosts = this.deps.hosts();
    switch (m.t) {
      case 'outSend': {
        const payload = readPayload(m.payload);
        if (!payload) return host.reply(m.req, null, '参数不对');
        return host.reply(m.req, hosts.send(payload, m.live === true, this.activeOutputs()));
      }
      case 'outTyping':
        if (hosts.hasTyping(this.activeOutputs())) hosts.typing(m.on === true);
        return;
      case 'outClear': return hosts.clear();
      case 'inDictate': return hosts.dictate(m.on === true);
      case 'trAsk':
        if (typeof m.text !== 'string') return host.reply(m.req, null, '参数不对');
        hosts.translate(m.text).then(t => host.reply(m.req, t), (e: unknown) => host.reply(m.req, null, errorText(e)));
        return;
      case 'setOn':
        // 只开关装着的输出组件：别的组件的开关归组件管理(主窗口)。页面能经远程服务让提供方发这个请求，所以在这里限制
        if (this.deps.components().some(c => c.id === m.id && c.kind === 'output')) this.deps.setOn(m.id, m.on === true);
        return;
      case 'clipRead':
        // 读不了时回空
        this.deps.clipboard.readText().then(t => host.reply(m.req, t), () => host.reply(m.req, ''));
        return;
      case 'clipWrite':
        if (typeof m.text === 'string') this.deps.clipboard.writeText(m.text).catch(() => undefined);
        return;
    }
  }
}
