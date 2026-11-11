<!-- 组件页右栏的标题行：左边标题，右边一排图标按钮(悬停显示名字)，最后是「安装组件」菜单 -->
<script setup lang="ts">
import { NDropdown } from 'naive-ui';
import { Plus } from '@lucide/vue';
import { t } from './i18n.ts';
import { installMenu, onInstallMenu } from './install.ts';
import type { HeadAction } from './head-action.ts';
import ActionHead from '../../_shared/window/ActionHead.vue';
import IconAction from '../../_shared/window/IconAction.vue';

defineProps<{ title: string; actions: readonly HeadAction[] }>();
</script>

<template>
  <action-head :title="title" detail>
    <icon-action v-for="(a, i) in actions" :key="i" :title="a.title" :disabled="a.disabled" @click="a.run()">
      <component :is="a.icon" :size="18" />
    </icon-action>
    <n-dropdown trigger="click" :options="installMenu" placement="bottom-end" @select="onInstallMenu">
      <icon-action :title="t('comp.install')"><plus :size="18" /></icon-action>
    </n-dropdown>
  </action-head>
</template>
