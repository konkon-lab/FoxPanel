// 关闭询问是否打开；宿主问一次就打开(只接一次，组件重新加载也不重复接)
import { ref } from 'vue';
import { fox } from '@konkon-lab/foxpanel-window';

export const asking = ref(false);

// 新版本弹窗里点了「稍后」的那个版本：这次运行里不再为它弹(组件重新加载也记着)
export const dismissed = ref<string | null>(null);

const SKIP_KEY = 'foxpanel.update.skipped';   // 页面存储里记着跳过的那个版本的键

// 页面存储里记着的跳过的版本；读不了、没记过时为 null
function stored(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
}

// 新版本弹窗里点了「跳过此版本」的那个版本：以后都不再为它弹，记在页面存储里
export const skipped = ref<string | null>(stored());

// 跳过 version 这个版本
export function skip(version: string): void {
  skipped.value = version;
  try {
    localStorage.setItem(SKIP_KEY, version);
  } catch { /* 存不了时这次运行里照样不弹 */ }
}

fox.onCloseAsk(() => { asking.value = true; });
