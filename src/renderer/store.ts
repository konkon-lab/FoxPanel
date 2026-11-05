// 主窗口状态：设置、组件列表、更新、版本、数据文件夹、状态栏数据、运行日志；数据来自主进程。

import { markRaw, reactive } from 'vue';
import { textOf } from '../shared/manifest.ts';
import { DEFAULT_APP, DEFAULT_MARKET, LOG_KEEP, type ComponentList, type Locale, type LogEntry, type Settings, type SysStats, type UpdateState } from '../shared/types.ts';

export const fox = window.fox;

interface Store {
  ready: boolean;
  settings: Settings;
  comps: ComponentList;   // 组件管理的列表
  update: UpdateState;
  version: string;
  dataDir: string;
  stats: SysStats;      // 状态栏：CPU、内存、组件上报的项
  logs: LogEntry[];     // 运行日志，旧的在前
}

export const store = reactive<Store>({
  ready: false,
  settings: { language: 'system', components: { order: [], off: [], config: {}, removed: [], dev: [], devMode: false, groups: [], folded: [], names: {}, market: DEFAULT_MARKET }, app: DEFAULT_APP, panels: { dark: false } },
  comps: { rows: [], broken: [], devMode: false, host: 'idle' },
  update: { state: 'idle' },
  version: '',
  dataDir: '',
  stats: { cpu: 0, mem: 0, items: [] },
  logs: [],
});

// 读主进程的初始数据并订阅变化
export async function initStore(): Promise<void> {
  const init = await fox.init();
  store.settings = init.settings;
  store.version = init.version;
  store.dataDir = init.dataDir;
  fox.onStats(s => { store.stats = s; });
  // 日志行写进来之后没有人改：标成不做响应式代理，只有列表本身是响应式的
  store.logs = (await fox.logList()).map(l => markRaw(l));
  // 推来的新行可能已经在初始列表里：按 id 只收更新的
  fox.onLog(lines => {
    const last = store.logs.at(-1)?.id ?? 0;
    store.logs.push(...lines.filter(l => l.id > last).map(l => markRaw(l)));
    if (store.logs.length > LOG_KEEP) store.logs.splice(0, store.logs.length - LOG_KEEP);
  });
  fox.onSettings(s => { store.settings = s; });
  store.comps = await fox.compList();
  fox.onCompList(list => { store.comps = list; });
  store.update = await fox.updateState();
  fox.onUpdate(u => { store.update = u; });
  store.ready = true;
}

// 组件的名字(按界面语言)；没有这个组件时显示 id
export const componentName = (id: string, locale: Locale): string => {
  const row = store.comps.rows.find(r => r.id === id);
  return row ? textOf(row.name, locale) : id;
};
