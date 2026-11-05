// 当前页面和组件页的选中项(给页面组件的跳转 API)。'home'、'components' 是预装的仪表盘、组件管理注册的页面 id。

import { reactive } from 'vue';

// component = 组件页选中的组件 id，group = 选中的分组 key(两者最多一个)
export const nav = reactive<{ page: string; component: string | null; group: string | null }>({ page: 'home', component: null, group: null });

export function openPage(id: string): void {
  nav.page = id;
}

// 打开组件页并选中一个组件
export function openComponent(id: string | null): void {
  nav.component = id;
  nav.group = null;
  nav.page = 'components';
}

// 打开组件页并选中一个分组
export function openGroup(key: string): void {
  nav.group = key;
  nav.component = null;
  nav.page = 'components';
}
