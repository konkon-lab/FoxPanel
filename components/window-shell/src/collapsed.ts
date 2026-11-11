// 侧栏收起：状态交给宿主记(下次启动沿用)
import { computed } from 'vue';
import { fox, store } from '@konkon-lab/foxpanel-window';

export const collapsed = computed({
  get: () => store.settings.app.navCollapsed,
  set: (v: boolean) => {
    store.settings.app.navCollapsed = v;
    void fox.setApp({ navCollapsed: v });
  },
});
