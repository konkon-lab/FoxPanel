<!-- 等确认的安装(名字和版本、替换的版本、带代码的提醒、取消 / 安装)和最近一次出错的提示(点一下收起)；两样都没有时不显示。
     默认浮在右栏上方居中，多一行「类别 · 作者 · 许可证」(组件页)；sticky 时贴在滚动区域顶上、不占高度(依赖管理页) -->
<script setup lang="ts">
import { NButton } from 'naive-ui';
import { locale, textOf } from '@konkon-lab/foxpanel-window';
import type { PendingInstall } from '@konkon-lab/foxpanel-sdk';
import { kindName, t } from './i18n.ts';

defineProps<{ pending: PendingInstall | null; error: string; sticky?: boolean }>();
const emit = defineEmits<{ confirm: [ok: boolean]; dismiss: [] }>();
</script>

<template>
  <div v-if="pending || error" class="float" :class="{ sticky }">
    <div v-if="pending" class="confirm">
      <b>{{ t('comp.installTitle', { name: textOf(pending.manifest.name, locale), version: pending.manifest.version }) }}</b>
      <span v-if="!sticky" class="meta">{{ [kindName(pending.manifest.kind), pending.manifest.author, pending.manifest.license].join(' · ') }}</span>
      <span v-if="pending.replaces !== null" class="meta">{{ t('comp.replaces', { version: pending.replaces }) }}</span>
      <p v-if="pending.code" class="warn">{{ t('comp.codeWarn') }}</p>
      <span class="buttons">
        <n-button @click="emit('confirm', false)">{{ t('comp.cancel') }}</n-button>
        <n-button type="primary" @click="emit('confirm', true)">{{ t('comp.confirmInstall') }}</n-button>
      </span>
    </div>
    <p v-if="error" class="error" :title="sticky ? undefined : error" @click="emit('dismiss')">{{ error }}</p>
  </div>
</template>

<style scoped>
.float {
  width: min(560px, calc(100% - 48px));
}
.float:not(.sticky) {
  position: absolute;
  top: 64px;
  left: 50%;
  z-index: 5;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.float.sticky {
  position: sticky;
  top: 52px;
  z-index: 2;
  margin: 0 auto;
  height: 0;
  overflow: visible;
}
.confirm {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.14);
}
.warn {
  margin: 6px 0 0;
  color: var(--warning);
}
.sticky .warn {
  margin-top: 4px;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.sticky .buttons {
  margin-top: 0;
}
.error {
  margin: 0;
  padding: 10px 16px;
  border: 1px solid var(--warning-line);
  border-radius: var(--radius);
  background: var(--warning-bg);
  color: var(--warning);
  cursor: pointer;
}
.sticky .error {
  margin-top: 8px;
}
</style>
