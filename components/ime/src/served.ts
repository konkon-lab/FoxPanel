// 远程服务 keyboard 收到的调用：参数是别的组件和页面发来的，在这里收窄后交给键盘流程。

import type { Caller, KeyboardAction, KeyboardCalls, Served } from '@konkon-lab/foxpanel-sdk';
import { parseAction } from './actions.ts';

// 这里用到的键盘流程
export interface KeyboardEntry {
  act(a: KeyboardAction): Promise<void>;
  dictated(text: string, final: boolean): void;
  dictationEnded(): void;
}

// inputs = 接了听写的输入源组件 id。格式不对的操作和文字丢掉；
// 听写结果和听写结束只收接了听写的主进程组件发来的，页面和别的组件发的丢掉
export function keyboardCalls(kb: KeyboardEntry, inputs: () => readonly string[]): Served<KeyboardCalls> {
  const fromInput = (caller: Caller): boolean => caller.where === 'process' && inputs().includes(caller.component);
  return {
    act(_caller, a) {
      const action = parseAction(a);
      return action ? kb.act(action) : undefined;
    },
    insert: (_caller, text) => (typeof text === 'string' ? kb.act({ kind: 'text', text }) : undefined),
    dictated(caller, text, final) {
      if (fromInput(caller) && typeof text === 'string') kb.dictated(text, final === true);
    },
    dictationEnded(caller) {
      if (fromInput(caller)) kb.dictationEnded();
    },
  };
}
