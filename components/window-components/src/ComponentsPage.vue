<!-- 组件页：左边分组树，右边选中的组件或分组；安装确认和出错提示浮在右栏上方 -->
<script setup lang="ts">
import { computed } from 'vue';
import { nav, store } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import { confirmInstall, pending } from './install.ts';
import { lastError } from './ops.ts';
import CompTree from './CompTree.vue';
import CompView from './CompView.vue';
import GroupView from './GroupView.vue';
import HeadBar from './HeadBar.vue';
import InstallFloat from '../../_shared/window/InstallFloat.vue';

const row = computed(() => store.comps.rows.find(r => r.id === nav.component) ?? null);
</script>

<template>
  <div class="comps">
    <comp-tree />
    <div class="right">
      <install-float :pending="pending" :error="lastError" @confirm="(ok: boolean) => void confirmInstall(ok)" @dismiss="lastError = ''" />
      <comp-view v-if="row" :row="row" />
      <group-view v-else-if="nav.group" :group-key="nav.group" />
      <div v-else class="view">
        <head-bar :title="t('comp.title')" :actions="[]" />
        <p class="meta empty">{{ t('cp.empty') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comps {
  height: 100%;
  display: flex;
  min-height: 0;
}
.right {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.empty {
  margin: 48px auto;
}
</style>
