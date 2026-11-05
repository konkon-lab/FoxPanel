<!-- 主窗口：Naive UI 的主题和语言跟着系统配色和界面语言；读初始数据和加载组件时转圈；
     之后显示外壳组件(插槽 layout，组件顺序最前的)和插槽 app 的内容；没有外壳时显示一行提示和关闭按钮(窗口没有系统边框) -->
<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { darkTheme, dateEnUS, dateJaJP, dateKoKR, dateZhCN, dateZhTW, enUS, jaJP, koKR, NButton, NConfigProvider, NSpin, useOsTheme, zhCN, zhTW } from 'naive-ui';
import { darkOverrides, themeOverrides } from './theme.ts';
import { fox, store } from './store.ts';
import { locale, t } from './i18n/index.ts';
import { windows } from './windows.ts';

const os = useOsTheme();
const dark = computed(() => os.value === 'dark');

const NAIVE = { 'zh-Hans': [zhCN, dateZhCN], 'zh-Hant': [zhTW, dateZhTW], ja: [jaJP, dateJaJP], en: [enUS, dateEnUS], ko: [koKR, dateKoKR] } as const;
const naive = computed(() => NAIVE[locale.value]);
watchEffect(() => { document.documentElement.lang = locale.value; });

const ready = computed(() => store.ready && windows.ready);
const layout = computed(() => windows.slots.find(s => s.type === 'layout') ?? null);
const appSlots = computed(() => windows.slots.filter(s => s.type === 'app'));
</script>

<template>
  <n-config-provider :locale="naive[0]" :date-locale="naive[1]" :theme="dark ? darkTheme : null" :theme-overrides="dark ? darkOverrides : themeOverrides" class="app">
    <div v-if="!ready" class="center"><n-spin size="small" /></div>
    <component :is="layout.component" v-else-if="layout" />
    <div v-else class="center bare">
      <p>{{ t('core.noShell') }}</p>
      <n-button @click="fox.winClose()">{{ t('core.close') }}</n-button>
    </div>
    <component :is="s.component" v-for="s in appSlots" :key="s.owner" />
  </n-config-provider>
</template>

<style scoped>
.app {
  height: 100%;
}
.center {
  height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 16px;
  background: var(--page-bg);
}
/* 没有外壳时整个窗口可以拖动，按钮除外 */
.bare {
  -webkit-app-region: drag;
}
.bare button {
  -webkit-app-region: no-drag;
}
</style>
