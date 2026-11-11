// 安装组件：开着市场时跳到市场页；选 zip → 解开检查 → 等确认；开发者模式下从文件夹加载。各页的「安装组件」按钮共用。

import { computed, ref } from 'vue';
import { fox, openPage, store, windows } from '@konkon-lab/foxpanel-window';
import type { PendingInstall } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import { lastError, run } from './ops.ts';

// 选好、等确认的安装
export const pending = ref<PendingInstall | null>(null);

// 选一个 zip：检查通过的等确认，取消选择时什么都不做
async function pick(): Promise<void> {
  lastError.value = '';
  const r = await fox.compPick();
  if (r.ok) pending.value = { manifest: r.manifest, code: r.code, replaces: r.replaces };
  else if ('error' in r) lastError.value = r.error;
}

// 确认(装上)或取消等确认的安装
export async function confirmInstall(ok: boolean): Promise<void> {
  pending.value = null;
  await run(fox.compInstall(ok));
}

// 「安装组件」下拉菜单的项
export const installMenu = computed(() => [
  ...(windows.pages.some(p => p.id === 'market') ? [{ key: 'market', label: t('cp.installMarket') }] : []),
  { key: 'zip', label: t('cp.installZip') },
  ...(store.comps.devMode ? [{ key: 'dev', label: t('comp.devAdd') }] : []),
]);

export function onInstallMenu(key: string): void {
  if (key === 'market') openPage('market');
  else if (key === 'zip') void pick();
  else if (key === 'dev') void run(fox.compDevAdd());
}
