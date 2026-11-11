<!-- 顶栏：左边名称，右边三个圆点(最小化、最大化 / 还原、关闭)；整条可拖动窗口(拖动区收不到鼠标事件，双击由系统切换最大化) -->
<script setup lang="ts">
import { fox } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
</script>

<template>
  <header class="tb">
    <span class="name">FoxPanel</span>
    <span class="caps">
      <button type="button" class="cap min" :title="t('shell.minimize')" :aria-label="t('shell.minimize')" @click="fox.winMinimize()" />
      <button type="button" class="cap max" :title="t('shell.maximize')" :aria-label="t('shell.maximize')" @click="fox.winMaximize()" />
      <button type="button" class="cap close" :title="t('shell.close')" :aria-label="t('shell.close')" @click="fox.winClose()" />
    </span>
  </header>
</template>

<style scoped>
.tb {
  height: 32px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
}
.name {
  font-family: Consolas, monospace;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  pointer-events: none;
}
.caps {
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
}
.cap {
  width: 12px;
  height: 12px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}
.cap:hover {
  filter: brightness(0.92);
}
.min {
  background: #f5bf4f;
}
.max {
  background: #61c554;
}
.close {
  background: #ed6a5e;
}
</style>
