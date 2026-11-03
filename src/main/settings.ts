// 配置文件 config.json：读出来收窄成 Settings(缺的项用默认值，格式不对的项修正)、整份保存。

import fs from 'node:fs';
import { readComponents } from './components/settings.ts';
import { CLOSE_ACTIONS, DEFAULT_APP, THEME_MODES, type AppSettings, type LanguageSetting, type Log, type PanelSettings, type Settings } from '../shared/types.ts';
import { errorText, isLocale, isObject } from '../shared/util.ts';

// 主窗口缩放的范围(倍数)
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;

// AppSettings 里值是开关的键
type AppFlag = { [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never }[keyof AppSettings];

export const isLanguage = (v: unknown): v is LanguageSetting => v === 'system' || isLocale(v);

// v 在名单里就用它，否则用 fallback
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => list.find(x => x === v) ?? fallback;

// 应用设置：缩放限制在范围内
export function readApp(v: unknown): AppSettings {
  const o = isObject(v) ? v : {};
  const flag = (k: AppFlag): boolean => {
    const x = o[k];
    return typeof x === 'boolean' ? x : DEFAULT_APP[k];
  };
  const zoom = o['zoom'];
  return {
    closeAction: oneOf(CLOSE_ACTIONS, o['closeAction'], DEFAULT_APP.closeAction),
    admin: flag('admin'),
    theme: oneOf(THEME_MODES, o['theme'], DEFAULT_APP.theme),
    zoom: typeof zoom === 'number' && Number.isFinite(zoom) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) : DEFAULT_APP.zoom,
    autoCheck: flag('autoCheck'), autoDownload: flag('autoDownload'), beta: flag('beta'), navCollapsed: flag('navCollapsed'),
  };
}

// 面板的外观：没写或不是开关时是浅色
export function readPanels(v: unknown): PanelSettings {
  return { dark: isObject(v) && v['dark'] === true };
}

// 配置文件里 settings 的内容 → Settings；preinstalledDir 是预装列表所在的目录(没有分组时用它的)
export function readSettings(raw: unknown, preinstalledDir: string): Settings {
  const o = isObject(raw) ? raw : {};
  return {
    language: isLanguage(o['language']) ? o['language'] : 'system',
    components: readComponents(o['components'], preinstalledDir),
    app: readApp(o['app']),
    panels: readPanels(o['panels']),
  };
}

// 读配置文件。没有文件 = 首次启动，用默认设置；读不了、不是 JSON、内容不是对象时
// 把文件另存一份 <file>.bad 并写日志，用默认设置
export function loadSettings(file: string, preinstalledDir: string, log: Log): Settings {
  let config: unknown;
  let problem = '';
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(config)) problem = 'not an object';
  } catch (e) {
    if (!isObject(e) || e['code'] !== 'ENOENT') problem = errorText(e);
  }
  if (problem) {
    log(`config file unreadable (${problem}), using defaults; a copy is kept as ${file}.bad`, 'warn');
    try {
      fs.copyFileSync(file, `${file}.bad`);
    } catch {
      // 文件本身读不了时留不了副本
    }
  }
  return readSettings(isObject(config) ? config['settings'] : undefined, preinstalledDir);
}

// 整份保存：经临时文件替换原文件，写到一半退出时原文件不受影响；
// 替换不了时(Windows 上原文件正被别的程序开着)直接写原文件，不留临时文件
export function saveSettings(file: string, settings: Settings): void {
  const tmp = `${file}.tmp`;
  const data = JSON.stringify({ settings }, null, 2);
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.writeFileSync(file, data);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}
