// 键盘的约定(预装的输入法组件 yanuo.ime 提供)：远程服务 keyboard 发布的状态和设置、能调的方法、语言包、操作，
// 和它的页面部分提供的 kb 服务。宿主只转发，不看内容。

import type { Text } from '../src/shared/manifest.ts';
import type { Locale } from '../src/shared/types.ts';

// 键盘上文字的语言，跟主窗口的界面语言
export type UiLang = Locale;

// 键盘上的名字：写法和缺语言时的回退同 Text
export type Labels = Text;

export interface PackMode {
  id: string;
  label: Labels;
  key?: string;                        // 模式键上的字，默认取名字的第一个字
  schema?: string;                     // 这个模式用的 rime 方案，默认用语言的
  switches?: Record<string, boolean>;  // 选方案后设的 rime 开关
  direct?: boolean;                    // 不经过输入法，直接打字母
  output?: 'composition' | 'katakana'; // 不出候选，上屏输入串(katakana = 换成片假名)
  lang?: string;                       // 这个模式的文字语言(选字体)，默认用语言的
}

// 清单 ime 字段的内容
export interface ImeDef {
  short: string;              // 语言键上的字
  lang: string;               // 文字语言(BCP 47)，选字体用
  engine: 'rime' | 'hangul';  // hangul = 内置韩文拼字
  schema: string;             // rime 方案；hangul 为空
  modes: PackMode[];          // 至少一个
  enter: 'raw' | 'rime';      // 输入中按回车：上屏字母 / 交给 rime
  latin: boolean;             // 拼音文字：大写字母也进输入串，空格、数字、符号先上屏再原样插入
  keycaps?: Record<string, readonly [string, string?]>;   // 字母键上印的字 [平时, Shift]
}

// 一种输入语言：id 是语言组件的 id
export interface ImePack extends ImeDef {
  id: string;
  name: Labels;
}

export interface KeyboardSettings {
  showTyping: boolean;          // 打字时让 VRChat 显示输入中
  autoSend: boolean;            // 停笔后自动发到聊天框
  pinMessage: boolean;          // 定时重发输入框文字，使其在 VRChat 中保持显示
  lang: string;                 // 当前语言(语言组件 id)
  modes: Record<string, string>;   // 各语言当前的模式(键是语言组件 id)
}

export interface CandidateItem {
  index: number;
  text: string;
}

// 远程服务 keyboard 的状态
export interface KeyboardState {
  ready: boolean;              // 输入法已部署好
  lang: string;                // 当前语言包
  uiLang: UiLang;
  packs: ImePack[];            // 开着的语言包，按面板顺序
  pack: ImePack;               // 当前语言包
  mode: PackMode;              // 当前语言包的模式
  text: string;
  caret: number;               // 光标位置(UTF-16)
  selStart: number;            // 选区 [selStart, selEnd)，无选区时两者相等
  selEnd: number;
  composition: string;         // 输入串(拼音、假名、韩文)，空 = 不在输入中
  compositionCaret: number;    // 输入串里的光标位置(UTF-16)
  candidates: CandidateItem[];
  dictating: boolean;          // 听写中
  dictation: string;           // 听写中还没说完的一句
  canDictate: boolean;         // 有输入源组件接了听写
  outputs: { id: string; name: Labels; on: boolean }[];   // 装着的输出组件(发送到)，按顺序
  settings: KeyboardSettings;
}

// 键位：与浏览器 KeyboardEvent.code 同名
export type KeyCode =
  | `Key${'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'}`
  | `Digit${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | 'Backquote' | 'Minus' | 'Equal' | 'BracketLeft' | 'BracketRight' | 'Backslash' | 'Semicolon' | 'Quote' | 'Comma' | 'Period' | 'Slash'
  | 'Space' | 'Backspace' | 'Delete' | 'Tab' | 'Enter' | 'Home' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

// 键盘面板里的部件和别的组件发给输入法组件的操作
export type KeyboardAction =
  | { kind: 'key'; code: KeyCode; shift: boolean; repeat?: boolean }   // shift：字母已按大写锁定换算；repeat：按住连发的(页面里的 kb.act 自己给退格、方向键标上)
  | { kind: 'text'; text: string }                    // 小键盘、特殊符号：直接插入
  | { kind: 'select'; index: number }                 // 选候选
  | { kind: 'caret'; position: number }
  | { kind: 'range'; start: number; end: number }     // 选中一段文字
  | { kind: 'paste' }
  | { kind: 'copy' }
  | { kind: 'clear' }
  | { kind: 'send' }
  | { kind: 'dictate' }                               // 开 / 关听写
  | { kind: 'clearOutputs' }                         // 清除各输出上显示的内容(聊天气泡)
  | { kind: 'output'; id: string; on: boolean }      // 开关一个输出组件
  | { kind: 'lang'; lang: string; mode?: string }    // 切换语言，可同时指定模式
  | { kind: 'settings'; patch: Partial<KeyboardSettings> };

// 远程服务 keyboard 能调的方法
export interface KeyboardCalls {
  act(a: KeyboardAction): void;                   // 按键等操作
  insert(text: string): void;                     // 在光标处插入
  dictated(text: string, final: boolean): void;   // 听写结果：final = false 只显示，true 插入；只收接了听写的输入源组件发的
  dictationEnded(): void;                         // 听写在别处停了；只收接了听写的输入源组件发的
}

// 输入框空着时在框里无事可做的键：退格和四个方向键
export type IdleKey = 'Backspace' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

// 输入法组件往总线频道 yanuo.ime/idle-key 发的通知：输入框空着(没有文字、没有在拼的输入串、没有听写中的字)时按了这些键，
// 别的组件据此在自己那边删字、移动。repeat = 按住连发的；从有字按住删到空的那一次不发，松开再按才发
export interface IdleKeyNotice {
  key: IdleKey;
  repeat: boolean;
}

// 页面里的输入状态和操作(输入法组件的页面部分提供，要 inject；清单里写 requires: ["keyboard"])
export interface KbService {
  readonly state: Readonly<KeyboardState>;   // 响应式(Vue reactive)，用 Vue 的组件可以直接在 computed 里读；也可以监听 kb/change
  readonly pack: ImePack;                    // 当前语言
  readonly mode: PackMode;                   // 当前语言的模式
  act(a: KeyboardAction): void;
  page(dir: -1 | 1): void;                   // 候选翻页：发出 kb/page，由候选栏处理
  setOutput(id: string, on: boolean): void;  // 开关一个输出组件(「发送到」)
}

// 输入法组件的页面部分在页面的上下文里发的事件
export interface KbEvents {
  'kb/change'(state: Readonly<KeyboardState>): void;   // 输入状态变了
  'kb/page'(dir: -1 | 1): void;                        // 候选翻页
}
