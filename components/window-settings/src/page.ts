// 设置组件：注册侧栏入口「设置」(排在最后)和设置页，提供 settings 服务(三节、配置项在不在设置页改)；本组件的配置(界面语言、关闭窗口时、以管理员身份运行、主题、缩放、更新)
// 分别登记到「常规」「外观」「更新与关于」，加载时把值交给宿主；「更新与关于」还放版本和检查更新、数据文件夹；关闭询问对话框和新版本弹窗放在整个窗口上(插槽 app)。

import { Settings } from '@lucide/vue';
import { fox, store, windows } from '@konkon-lab/foxpanel-window';
import type { CloseAction, LanguageSetting, SettingDef, ThemeMode, WindowContext, WindowSettingsService } from '@konkon-lab/foxpanel-sdk';
import { defineAll, textFrom } from '../../_shared/window/i18n.ts';
import { ABOUT, GENERAL, LOOK } from './sections.ts';
import { messages } from './i18n.ts';
import own from './locales.ts';
import SettingsPage from './SettingsPage.vue';
import DataDir from './DataDir.vue';
import UpdateRow from './UpdateRow.vue';
import CloseDialog from './CloseDialog.vue';
import UpdateDialog from './UpdateDialog.vue';

// 本组件几项配置能取的值(和清单 config 里的一致)
const LANGUAGES: readonly LanguageSetting[] = ['system', 'zh-Hans', 'zh-Hant', 'ja', 'en', 'ko'];
const ACTIONS: readonly CloseAction[] = ['ask', 'tray', 'quit'];
const THEMES: readonly ThemeMode[] = ['light', 'dark', 'system'];

// 设置页画得出来的配置项类型(开关、选择、数字、文字)；别的类型留在组件页改
const DRAWN: readonly SettingDef['type'][] = ['toggle', 'select', 'number', 'text'];

// 配置值在取值表里就用它，否则用默认值
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => list.find(x => x === v) ?? d;

export default {
  name: 'yanuo.window-settings',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    const service: WindowSettingsService = {
      sections: { general: GENERAL, look: LOOK, about: ABOUT },
      edits: (owner: string, def: SettingDef) => DRAWN.includes(def.type) && windows.settings.some(s => s.owner === owner && (s.keys === null || s.keys.includes(def.key))),
    };
    ctx.provide('settings', service);
    ctx.window.page({ id: 'settings', title: textFrom(own, 'settings.title'), icon: Settings, component: SettingsPage, order: 100 });
    ctx.window.settings({ ...GENERAL, keys: ['language', 'closeAction', 'admin'] });
    ctx.window.settings({ ...LOOK, keys: ['theme', 'zoom'] });
    ctx.window.settings({ ...ABOUT, keys: ['autoCheck', 'autoDownload', 'beta'], component: UpdateRow });
    ctx.window.settings({ ...ABOUT, order: ABOUT.order + 1, keys: [], component: DataDir });
    ctx.window.slot({ type: 'app', component: CloseDialog });
    ctx.window.slot({ type: 'app', component: UpdateDialog });

    // 值交给宿主：界面语言(主窗口、托盘、键盘)，其余是应用设置
    const c = ctx.config;
    const lang = pick(c['language'], LANGUAGES, 'system');
    if (lang !== store.settings.language) {
      store.settings.language = lang;
      void fox.setLanguage(lang);
    }
    const want = {
      closeAction: pick(c['closeAction'], ACTIONS, 'ask'),
      admin: c['admin'] === true,
      theme: pick(c['theme'], THEMES, 'system'),
      zoom: typeof c['zoom'] === 'number' ? c['zoom'] : 1,
      autoCheck: c['autoCheck'] !== false,
      autoDownload: c['autoDownload'] !== false,
      beta: c['beta'] === true,
    };
    const app = store.settings.app;
    if ((Object.keys(want) as (keyof typeof want)[]).some(k => want[k] !== app[k])) void fox.setApp(want);
  },
};
