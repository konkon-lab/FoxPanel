// 页面入口：挂上给页面组件的 @konkon-lab/foxpanel-window，挂载 Vue 应用，读初始数据后加载页面组件。

import { createApp } from 'vue';
import App from './App.vue';
import { initStore } from './store.ts';
import { installWindowApi } from './window-api.ts';
import { startWindows } from './windows.ts';
import './style.css';

installWindowApi();
createApp(App).mount('#app');
void initStore().then(startWindows);
