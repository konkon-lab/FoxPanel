// 宿主(主进程)和组件进程之间的消息。

import type { Caller, LogEntry, LogLevel, Locale, PanelInfo } from './types.ts';
import type { ComponentKind, Manifest, Text } from './manifest.ts';

// 要在组件进程里加载的组件
export interface HostComponent {
  id: string;
  file: string;                       // main 入口的绝对路径
  mtime: number;                      // 入口文件的修改时间(毫秒)，读不到时 0
  config: Record<string, unknown>;    // 设置，含解密后的 secret
}

// 发送给输出组件的一句
export interface OutputPayload {
  text: string;      // 原文
  spoken: string;    // 译文(没翻译时等于原文)
  notify: boolean;   // 提示音(VRChat 聊天框)
}

// 组件注册的输出能力
export interface OutputInfo {
  id: string;
  live: boolean;
  typing: boolean;
}

export type StorageOp =
  | { op: 'get'; key: string }
  | { op: 'set'; key: string; value: unknown }
  | { op: 'delete'; key: string };

// 宿主推给全部组件进程的应用信息
export interface AppInfo {
  version: string;                                                                       // 程序版本
  packaged: boolean;                                                                     // 是安装包里的程序，不是从源码启动的
  locale: Locale;                                                                        // 界面语言
  // 装着的全部组件，按组件顺序；on = 开关开着，active = 正在用(开着、单选类别里排最前、要的服务都有)
  components: { id: string; kind: ComponentKind; name: Text; dir: string; manifest: Manifest; on: boolean; active: boolean }[];
  outputs: { id: string; name: Text; on: boolean; live: boolean; typing: boolean }[];   // 装着的输出组件：开关、收不收实时内容、能不能显示正在输入
  inputs: string[];                                                                      // 接了听写的输入源组件 id，按组件顺序
  canDictate: boolean;                                                                   // 有输入源接了听写
}

// 主进程组件要宿主做的事(带 req 的要回 reply)：发给输出、开关听写、翻译、开关输出组件、读写系统剪贴板
export type AppRequest =
  | { t: 'outSend'; req: number; payload: OutputPayload; live: boolean }   // 回收到的组件 id
  | { t: 'outTyping'; on: boolean }
  | { t: 'outClear' }
  | { t: 'inDictate'; on: boolean }
  | { t: 'trAsk'; req: number; text: string }                     // 回译文，失败回 error
  | { t: 'setOn'; id: string; on: boolean }                       // id 不是装着的输出组件时不做
  | { t: 'clipRead'; req: number }                                // 回剪贴板里的文字，读不了回空串
  | { t: 'clipWrite'; text: string };

// 远程服务：组件进程发给宿主的。component = 发这条消息的组件 id
export type RelayRequest =
  | { t: 'rvServe'; component: string; name: string }                                   // 登记成 name 的提供方
  | { t: 'rvClose'; component: string; name: string }                                   // 撤掉登记
  | { t: 'rvState'; component: string; name: string; state: unknown }                   // 提供方发布状态
  | { t: 'rvUse'; name: string; on: boolean }                                           // 这个进程订阅 / 退订 name 的状态
  | { t: 'rvCall'; component: string; req?: number; name: string; method: string; args: unknown[] }   // 带 req 的等 reply
  | { t: 'rvResult'; req: number; value?: unknown; error?: string };                    // 提供方回 rvInvoke 的结果

// 面板页面怎么显示：frames = 离屏渲染、每一帧交给收帧的组件，window = 普通窗口
export const PANEL_MODES = ['frames', 'window'] as const;
export type PanelMode = typeof PANEL_MODES[number];

// 发给面板页面的指点事件。坐标是纹理像素(窗口方式下是页面像素)，宿主换成页面像素；
// move 的 held = 左键按着；wheel 的 dx、dy 是内容滚动的像素，dy 为正往下滚、dx 为正往右滚；leave = 指针移出了面板
export type PanelInput =
  | { kind: 'move'; x: number; y: number; held: boolean }
  | { kind: 'down' | 'up'; x: number; y: number }
  | { kind: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { kind: 'leave' };

// 面板页面的状态：在加载、加载好了、出错了(加载失败、渲染进程退出、开不了)、没了(面板不在目录里、窗口被关、被别的进程接走)
export type PanelPageState = 'loading' | 'ready' | 'failed' | 'gone';

// 显示方对面板页面的操作；component = 发这条消息的组件，id = 面板 id。pnOpen 以外的只认这一页当前的收帧方(那个进程里的那个组件)发的
export type PanelRequest =
  | { t: 'pnOpen'; component: string; id: string; mode: PanelMode }
  | { t: 'pnClose'; component: string; id: string; linger: boolean }   // linger = 页面留着进保留期(组件停用)，否则销毁
  | { t: 'pnRelease'; component: string; id: string; seq: number }     // 这一帧用完了
  | { t: 'pnInput'; component: string; id: string; event: PanelInput }
  | { t: 'pnPaint'; component: string; id: string; on: boolean }       // 停画 / 恢复
  | { t: 'pnFps'; component: string; id: string; fps: number };

// 宿主 → 组件进程
export type ToProcess =
  // shared = 指向宿主那份的模块(名字 → 地址)；dataDir = 数据文件夹；panels = 面板目录
  | { t: 'load'; components: HostComponent[]; info: AppInfo; panels: PanelInfo[]; shared: Record<string, string>; dataDir: string; appDir: string }
  | { t: 'apply'; components: HostComponent[] }   // 进程启动后组件列表变了：只加载、卸载、重载变了的
  | { t: 'send'; payload: OutputPayload; to: string[] }       // to = 收这一句的输出组件 id
  | { t: 'typing'; on: boolean }
  | { t: 'clear' }
  | { t: 'dictate'; on: boolean }
  | { t: 'bus'; channel: string; data: unknown }
  | { t: 'reply'; req: number; value: unknown; error?: string }
  | { t: 'translate'; req: number; text: string }
  | { t: 'logs'; lines: LogEntry[] }                          // 新的日志行(启动时先补发已有的)
  | { t: 'info'; info: AppInfo }                              // 应用信息变了
  | { t: 'pnList'; panels: PanelInfo[] }                      // 面板目录变了
  // 以下四条是面板页面的；component = 本进程里开这一页的组件，id = 面板 id
  | { t: 'pnFrame'; component: string; id: string; seq: number; handle: string; width: number; height: number }   // 一帧：handle = 复制进本进程的 NT 句柄(十进制)，宽高是这一帧纹理的像素
  | { t: 'pnDrop'; component: string; id: string; seq: number }                  // 宿主放掉了这一帧(压着的帧太多)，不能再用
  | { t: 'pnSize'; component: string; id: string; width: number; height: number }   // 面板的纹理像素(窗口方式下是页面像素)
  | { t: 'pnState'; component: string; id: string; state: PanelPageState; detail?: string }
  | { t: 'rvState'; name: string; state: unknown }            // 订阅了的远程服务的状态；null = 没有提供者
  // 本进程里 component 对 name 的登记生效没有：on 为假 = 等着(同名提供者里排在后面，或组件关着)。登记时发一次，之后变了才发
  | { t: 'rvActive'; name: string; component: string; on: boolean }
  // 远程服务的一次调用：component = 本进程里的提供方，caller = 宿主填的调用者；带 req 的要回 rvResult
  | { t: 'rvInvoke'; req?: number; name: string; component: string; method: string; args: unknown[]; caller: Caller };

// 组件进程 → 宿主
export type FromProcess =
  | { t: 'outputs'; outputs: OutputInfo[]; inputs: string[]; translator: boolean }   // 注册的输出、接了听写的输入源、有没有翻译
  | { t: 'loaded'; id: string; error?: string }
  | { t: 'storage'; id: string; req: number; call: StorageOp }
  | { t: 'bus'; channel: string; data: unknown }
  | { t: 'log'; id: string; text: string; level?: LogLevel }
  | { t: 'translated'; req: number; text?: string; error?: string }
  | { t: 'status'; id: string; item: unknown }                // 组件上报的状态栏一项，null = 去掉
  | PanelRequest
  | AppRequest
  | RelayRequest;
