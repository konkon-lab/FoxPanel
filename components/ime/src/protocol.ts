// 主进程和输入法工作线程之间的消息。直接打字母和韩文不经过 rime。

import type { CandidateItem } from '@konkon-lab/foxpanel-sdk';
import type { RimePaths } from './rime.ts';

export type ImeRequest =
  | { kind: 'init'; paths: RimePaths; schema: string | null; switches: Record<string, boolean> }   // schema 为 null = 当前语言不用 rime，不选方案
  | { kind: 'schema'; id: string; switches: Record<string, boolean> }   // 选 rime 方案并设开关
  | { kind: 'deploy' }                                   // 重新部署(装上 / 卸载语言包后)
  | { kind: 'key'; name: string }                        // name 为 keysym 名
  | { kind: 'char'; char: string }                       // 符号键；rime 不处理时由键盘自己插入
  | { kind: 'select'; index: number }
  | { kind: 'raw' }                                       // 取出原始输入并结束输入
  | { kind: 'clear' }
  | { kind: 'importDict'; dict: string; file: string };

// 就绪后打字用的请求
export type SessionRequest = Exclude<ImeRequest, { kind: 'init' | 'importDict' | 'deploy' }>;

// 每次请求后的输入状态；commit = 这次上屏的文字
export interface ImeResult {
  commit: string | null;
  composition: string;
  compositionCaret: number;   // 输入串里的光标位置
  candidates: CandidateItem[];   // index = 在全部候选里的序号
  handled?: boolean;          // char 请求：rime 有没有处理这个键
}

// 各请求的返回：导入词库返回条数(失败为 -1)，其余返回输入状态
export type ImeReply<R extends ImeRequest> = R extends { kind: 'importDict' } ? { count: number } : ImeResult;

// 线程回给调用端的消息：ok 和 error 有且只有一个
export interface ImeMessage {
  id: number;
  ok?: ImeResult | { count: number };
  error?: string;
}
