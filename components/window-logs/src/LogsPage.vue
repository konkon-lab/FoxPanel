<!-- 日志页：标题行「日志 LOGS」，下面深色日志框铺满；只显示不低于记录等级的行 -->
<script setup lang="ts">
import { computed } from 'vue';
import { store } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import { shown } from './level.ts';
import LogLines from './LogLines.vue';
import PageHead from '../../_shared/window/PageHead.vue';

const lines = computed(() => store.logs.filter(shown));
</script>

<template>
  <div class="view">
    <page-head :title="t('log.title')" legend="LOGS" />
    <main class="page">
      <log-lines class="lines" :lines="lines" />
    </main>
  </div>
</template>

<style scoped>
.view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 24px 32px;
}
.lines {
  flex: 1;
  min-height: 0;
}
</style>
