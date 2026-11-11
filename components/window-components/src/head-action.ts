// 组件页标题行右边的一个图标按钮。

import type { Component } from 'vue';

export interface HeadAction {
  title: string;       // 悬停时显示的名字
  icon: Component;
  disabled?: boolean;
  run: () => void;     // 点下去做的事
}
