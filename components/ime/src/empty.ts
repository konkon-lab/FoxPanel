// 空的键盘状态：远程服务 keyboard 没有状态时(输入法进程没起来、在重启)，页面里的 kb 服务用它。

import type { ImePack, KeyboardState } from '@konkon-lab/foxpanel-sdk';

// 占位的语言包：没有名字，一个没有名字的模式
const NO_PACK: ImePack = { id: '', name: '', short: '', lang: 'und', engine: 'rime', schema: '', enter: 'raw', latin: false, modes: [{ id: '', label: '' }] };

// 没就绪，什么都没有
export const EMPTY_KEYBOARD: KeyboardState = {
  ready: false, lang: '', uiLang: 'zh-Hans', packs: [], pack: NO_PACK, mode: NO_PACK.modes[0]!, text: '', caret: 0, selStart: 0, selEnd: 0,
  composition: '', compositionCaret: 0, candidates: [], dictating: false, dictation: '', canDictate: false, outputs: [],
  settings: { showTyping: false, autoSend: false, pinMessage: false, lang: '', modes: {} },
};
