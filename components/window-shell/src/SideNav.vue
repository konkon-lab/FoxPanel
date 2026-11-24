<!-- 侧栏：收起 / 展开按钮、页面组件注册的入口(按 order 排)，底部是程序图标、名称和版本号(点击用浏览器打开 GitHub 仓库)；收起时只显示图标 -->
<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { fox, locale, nav, store, textOf, windows } from '@konkon-lab/foxpanel-window';
import logo from './logo.png';
import { collapsed } from './collapsed.ts';
import { t } from './i18n.ts';

// 点击底部的程序信息时打开的仓库地址
const REPO = 'https://github.com/konkon-lab/FoxPanel';
</script>

<template>
  <nav class="side" :class="{ mini: collapsed }" :aria-label="t('shell.navAria')">
    <button
      type="button" class="collapse" :title="t(collapsed ? 'shell.navExpand' : 'shell.navCollapse')"
      :aria-label="t(collapsed ? 'shell.navExpand' : 'shell.navCollapse')" :aria-expanded="!collapsed" @click="collapsed = !collapsed"
    >
      <component :is="collapsed ? ChevronRight : ChevronLeft" :size="18" />
    </button>
    <div class="items">
      <button
        v-for="p in windows.pages" :key="p.id" type="button" class="item" :class="{ active: nav.page === p.id }"
        :aria-current="nav.page === p.id ? 'page' : undefined" :title="textOf(p.title, locale)" @click="nav.page = p.id"
      >
        <component :is="p.icon" :size="18" aria-hidden="true" />
        <span>{{ textOf(p.title, locale) }}</span>
      </button>
    </div>
    <button type="button" class="brand" :title="REPO" @click="void fox.openExternal(REPO)">
      <img class="logo" :src="logo" alt="">
      <span class="name">FoxPanel</span>
      <span v-if="store.version" class="ver">v{{ store.version }}</span>
    </button>
  </nav>
</template>

<style scoped>
.side {
  width: 196px;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--surface);
  border-right: 1px solid var(--line);
}
.side.mini {
  width: 64px;
}
.collapse {
  align-self: flex-start;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  margin-bottom: 12px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.mini .collapse {
  align-self: center;
}
.collapse:hover {
  background: var(--press-bg);
}
.items {
  display: grid;
  gap: 4px;
}
.item {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.mini .item {
  justify-content: center;
  gap: 0;
  padding: 0;
}
.mini .item span {
  display: none;
}
.item:hover {
  background: var(--hover-bg);
}
.item.active {
  background: var(--accent-tint);
  color: var(--accent);
}
/* 底部的图标、名称和版本号：margin-top: auto 推到侧栏最下面，悬停时显出浅灰底和边框 */
.brand {
  margin-top: auto;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  font: inherit;
  cursor: pointer;
  user-select: none;
}
.brand:hover {
  background: var(--hover-bg);
  border-color: var(--line);
}
.logo {
  width: 64px;
  height: 64px;
  margin-bottom: 4px;
}
.name {
  font-size: 13px;
  color: var(--text-secondary);
}
.ver {
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--text-secondary);
  opacity: 0.7;
}
.mini .brand {
  margin-bottom: 0;
  padding: 4px 0;
}
.mini .logo {
  width: 32px;
  height: 32px;
  margin-bottom: 0;
}
.mini .name,
.mini .ver {
  display: none;
}
</style>
