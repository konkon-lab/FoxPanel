// 键区自己的状态：Shift(按一次 / 锁定)、Caps、语言面板开着。

import { reactive } from 'vue';

export const ui = reactive({
  shift: false,        // 按一次 Shift，打一个字后松开
  shiftLock: false,    // 连按两次 Shift 锁定
  caps: false,
  langOpen: false,     // 语言选择面板打开
});
