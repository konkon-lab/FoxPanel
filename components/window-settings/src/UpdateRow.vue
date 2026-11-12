<!-- 「更新与关于」里的版本一行：FoxPanel 和版本号；右边更新状态和按钮(检查更新 / 下载更新 / 重启并安装)，状态怎么对到徽标和按钮在 update-view.ts -->
<script setup lang="ts">
import { computed } from 'vue';
import { NButton } from 'naive-ui';
import { fox, store } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import SettingLine from './SettingLine.vue';
import { badgeOf, buttonOf } from './update-view.ts';

const badge = computed<{ text: string; tone: 'ok' | 'wait' | 'warn' } | null>(() => {
  const b = badgeOf(store.update);
  return b && { text: t(b.key, b.params), tone: b.tone };
});
const button = computed(() => buttonOf(store.update.state));
function onButton(): void {
  if (button.value.action === 'install') void fox.updateInstall();
  else void fox.updateCheck();
}
</script>

<template>
  <setting-line label="FoxPanel" :desc="t('upd.version', { v: store.version })">
    <span class="acts">
      <span v-if="badge" class="badge" :class="badge.tone" :title="store.update.message">{{ badge.text }}</span>
      <n-button :loading="store.update.state === 'checking'" :disabled="button.disabled" @click="onButton">{{ t(button.text) }}</n-button>
    </span>
  </setting-line>
</template>

<style scoped>
.acts {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.badge {
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 12px;
  white-space: nowrap;
}
.badge.ok {
  background: rgba(31, 122, 71, 0.12);
  color: var(--success);
}
.badge.wait {
  background: var(--track);
  color: var(--text-secondary);
}
.badge.warn {
  background: var(--warning-bg);
  color: var(--warning);
}
</style>
