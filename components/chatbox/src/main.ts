// 聊天框输出：经 osc 服务发到 VRChat 的聊天框。

import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { chatboxText } from './text.ts';

const INPUT = '/chatbox/input';     // 参数：文字、立即显示(不进输入框)、提示音
const TYPING = '/chatbox/typing';   // 参数：是否正在输入

export default {
  name: 'yanuo.chatbox',
  inject: ['osc'],
  apply(ctx: MainContext) {
    ctx.output.register({
      live: true,
      send: ({ text, spoken, notify }) => {
        const shown = chatboxText(text, spoken);
        ctx.osc.send(INPUT, [shown, true, notify]);
        ctx.log(`sent: ${shown}`);
      },
      typing: on => ctx.osc.send(TYPING, [on]),
      clear: () => ctx.osc.send(INPUT, ['', true, true]),
    });
  },
};
