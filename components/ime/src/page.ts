// 输入法组件的页面部分(跑在键盘面板的页面里)：提供 kb 服务。输入状态读远程服务 keyboard(本组件的主进程部分发布)，操作发给它；
// 输入法没部署好(或它的进程没起来)时盖住整页。

import { reactive, toRaw } from 'vue';
import type { KbService, KeyboardAction, KeyboardState, PageContext } from '@konkon-lab/foxpanel-sdk';
import { isIdleKey } from '../../_shared/keyboard.ts';
import { EMPTY_KEYBOARD } from './empty.ts';
import { deployingVeil } from './veil.ts';

export default {
  name: 'yanuo.ime',
  inject: ['overlay', 'i18n'],
  apply(ctx: PageContext) {
    const remote = ctx.relay.use('keyboard');
    // 页面组件拿到的状态始终是这一个响应式对象：远程服务没有状态时内容是空状态，有状态时逐个字段跟上
    const state = reactive<KeyboardState>({ ...EMPTY_KEYBOARD });
    // 远程服务的状态里内容没变的字段是同一个值：只给换了值的字段赋值，依赖别的字段的计算和渲染不动
    const follow = (next: Readonly<KeyboardState> | null): void => {
      const from: Readonly<KeyboardState> = next ? toRaw(next) : EMPTY_KEYBOARD;
      const current = toRaw(state);
      for (const key of Object.keys(EMPTY_KEYBOARD) as (keyof KeyboardState)[]) {
        if (current[key] !== from[key]) (state as Record<keyof KeyboardState, unknown>)[key] = from[key];
      }
    };
    follow(remote.state);
    ctx.effect(() => remote.watch(next => {
      follow(next);
      ctx.emit('kb/change', state);
    }));

    // 一次按下只有第一个退格、方向键 是新按的，同一次按下里再来的是按住连发的
    let presses = 0;
    let marked = -1;
    if (typeof document !== 'undefined') {
      const down = (): void => { presses++; };
      ctx.effect(() => {
        document.addEventListener('mousedown', down, true);
        return () => document.removeEventListener('mousedown', down, true);
      });
    }
    const mark = (a: KeyboardAction): KeyboardAction => {
      if (a.kind !== 'key' || !isIdleKey(a.code) || presses === 0) return a;
      const repeat = marked === presses;
      marked = presses;
      return { ...a, repeat };
    };
    const kb: KbService = {
      get state() { return state; },
      get pack() { return state.pack; },
      get mode() { return state.mode; },
      // 交给宿主就返回，不等输入法处理完；同一页发的操作按先后送到
      act: a => remote.tell('act', mark(a)),
      page: dir => { ctx.emit('kb/page', dir); },
      setOutput: (id, on) => remote.tell('act', { kind: 'output', id, on }),
    };
    ctx.provide('kb', kb);
    // 没部署好期间开着一层提示，点不到下面的键
    ctx.effect(() => deployingVeil(ctx, () => !state.ready));
  },
};
