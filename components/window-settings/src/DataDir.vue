<!-- 「更新与关于」里的数据文件夹一行(路径 + 打开文件夹)和页脚 -->
<script setup lang="ts">
import { NButton } from 'naive-ui';
import { fox, store } from '@konkon-lab/foxpanel-window';
import { t } from './i18n.ts';
import SettingLine from './SettingLine.vue';
</script>

<template>
  <div>
    <setting-line :label="t('settings.dataDirLabel')" :desc="t('settings.dataDirDesc')">
      <span class="acts">
        <span class="path" :title="store.dataDir">{{ store.dataDir }}</span>
        <n-button @click="fox.openDataDir()">{{ t('settings.openFolder') }}</n-button>
      </span>
    </setting-line>
    <div class="footer meta">© 2026 雅诺狐</div>
  </div>
</template>

<style scoped>
.acts {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.path {
  color: var(--text-secondary);
  font-family: Consolas, monospace;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
  user-select: text;
}
.footer {
  padding: 14px 20px;
}
</style>
