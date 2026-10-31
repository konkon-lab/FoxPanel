// 组件清单 component.json：类型和校验。主进程读清单、页面显示名字都用这里的类型。

import type { Locale } from './types.ts';
import { isText, KEY, parseConfig, SLUG, type ConfigSection, type SettingDef, type Text } from './schema.ts';
import { isObject } from './util.ts';

export { defaultConfig, isVisible, type ConfigSection, type SettingDef, type Text } from './schema.ts';

export const COMPONENT_KINDS = [
  'panel', 'candidates', 'textfield', 'layout', 'sidepage', 'sidebutton', 'skin', 'lang', 'output', 'input', 'translator', 'service', 'window',
] as const;
export type ComponentKind = typeof COMPONENT_KINDS[number];
export const isComponentKind = (v: unknown): v is ComponentKind => (COMPONENT_KINDS as readonly unknown[]).includes(v);

// 同时只能开一个的类别(也可以都不用)；其余可以开多个
export const SINGLE_KINDS: ReadonlySet<ComponentKind> = new Set(['candidates', 'textfield', 'layout', 'skin', 'translator']);

// 页面代码跑在媒体页面(隐藏窗口，没有插槽)里的类别
export const MEDIA_KINDS: ReadonlySet<ComponentKind> = new Set(['output', 'input', 'translator']);

// 挂进面板插槽的类别：插槽名等于类别名
export const PART_KINDS: ReadonlySet<ComponentKind> = new Set(['candidates', 'textfield', 'layout', 'sidepage', 'sidebutton']);

// 面板第一次出现时附着在哪：留在空间里、跟头、跟左手、跟右手
export const PANEL_ANCHORS = ['world', 'head', 'left', 'right'] as const;
export type PanelAnchor = typeof PANEL_ANCHORS[number];

// 面板第一次出现的位置：正前方、前下方、右前方
export const PANEL_SPAWNS = ['front', 'low', 'side'] as const;
export type PanelSpawn = typeof PANEL_SPAWNS[number];

// 面板的纹理倍数：纹理像素 = 页面像素 × 倍数
export const PANEL_SCALES = [1, 1.5, 2] as const;
export type PanelScale = typeof PANEL_SCALES[number];

// 组件提供的一块面板(清单的 panel 字段，已补默认值)
export interface PanelDecl {
  page: string;               // 根组件入口(ES 模块)，组件包内的相对路径
  width: number;              // 页面宽高(CSS 像素)
  height: number;
  scale: PanelScale;          // 纹理倍数
  fps: number;                // 帧率上限
  meters: number;             // 默认宽度(米)
  minMeters: number;          // 用户能缩放到的宽度范围(米)
  maxMeters: number;
  anchor: PanelAnchor;
  spawn: PanelSpawn;
  glance: boolean;            // 附着在手上时只在正面朝向眼睛时显示
  keep: boolean;              // 收起后页面不关
  sound: boolean;            // 页面出声(按键音)
  slots: string[];            // 根组件有哪些插槽(名字)
}

// 必须有 page 入口的类别(layout 也可以用布局 JSON)
const NEEDS_PAGE: ReadonlySet<ComponentKind> = new Set(['candidates', 'textfield', 'sidepage', 'sidebutton', 'window']);

export interface Manifest {
  id: string;
  kind: ComponentKind;
  name: Text;
  version: string;
  author: string;
  license: string;
  description?: Text;
  repository?: string;                            // 存储库地址(http / https)
  bugs?: string;                                  // 问题反馈地址(http / https)
  page?: string;                                  // 页面入口(ES 模块)，组件包内的相对路径；window 组件跑在主窗口，输出、输入源、翻译跑在媒体页面，其他跑在面板页面
  panel?: PanelDecl;                              // 提供的面板(panel 组件必须写，别的类别也能写)
  window?: string;                                // 主窗口入口(window 组件用 page)：给主窗口提供服务、往插槽放内容
  main?: string;                                  // 主进程入口
  process?: 'own';                                // own：main 跑在自己的进程里(别的组件变了不重启它，崩了只重启它)
  icon?: string;                                  // 图标(svg)，组件包内的相对路径
  layout?: string;                                // 布局 JSON，组件包内的相对路径
  skin?: string;                                  // 皮肤 css，组件包内的相对路径
  ime?: unknown;                                  // 语言(格式由输入法组件校验)
  settings: SettingDef[];                         // config 里的全部设置项
  sections: ConfigSection[];                      // 设置的分节
  enabled: boolean;                               // 装上时开着；false = 先关着，在组件页打开
  usage?: UsageDecl;                              // 记用量的组件：币种和用量单位
  dashboard?: DashboardCard;                      // 仪表盘上的快捷设置卡
  provides?: string[];                            // 服务组件提供的服务名
  requires?: string[];                            // 要用的服务名；没有开着的服务组件提供时不加载
  uses?: string[];                                // 会用的远程服务名：没有提供者也照常加载，页面里的组件写了才够得着
}

// 仪表盘上的快捷设置卡：组件关着时也显示(开关在卡片上)
export interface DashboardCard {
  title: Text;
  keys: string[];             // 卡片上列出的配置项
  area: 'left' | 'right';     // 放在哪一列
  order: number;              // 同列从小到大，和插槽 dashboard 里的卡片一起排
  toggle?: Text;              // 标题旁放组件的开关，这是开关的说明
  link: boolean;              // 标题旁放「前往设置」
  grow: boolean;              // 撑满所在列的剩余高度
}

// 用量的币种和各用量的单位名(calls 是宿主自动记的次数)
export interface UsageDecl {
  currency: string;
  units: Record<string, Text>;
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; errors: string[] };

const ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
export const isComponentId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CURRENCY = /^[A-Z]{3}$/;   // 币种代码
// 清单里写组件包内相对路径的字段
const PATH_KEYS = ['page', 'window', 'main', 'icon', 'layout', 'skin'] as const;

// 网页地址：只认 http / https
export function isWebUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

// 组件包内的相对路径：不能是绝对路径，不能有 .. 段
export function isInnerPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return false;
  return p.split(/[\\/]/).every(seg => seg !== '..' && seg !== '');
}

const isServiceName = (v: unknown): v is string => typeof v === 'string' && SLUG.test(v);
const isUnits = (v: unknown): v is Record<string, Text> => isObject(v) && Object.entries(v).every(([k, name]) => KEY.test(k) && isText(name));

export const PANEL_SIDE_MIN = 64;             // 面板页面宽高的范围(CSS 像素)
export const PANEL_SIDE_MAX = 4096;
export const PANEL_TEXELS_MAX = 4_194_304;    // 一块面板的纹理像素数(宽 × 高 × 倍数²)上限
export const PANEL_FPS_MAX = 60;              // 面板帧率上限的最大值
const PANEL_FPS = 30;                         // 没写 fps 时的帧率上限
export const PANEL_METERS_MIN = 0.05;         // 面板宽度的范围(米)
export const PANEL_METERS_MAX = 3;
const PANEL_METERS = 0.5;                     // 没写 meters 时的默认宽度(米)
const PANEL_ZOOM_MIN = 0.1;                   // 没写 minMeters、maxMeters 时用户能缩放到的范围(米)；默认宽度在这个范围外时范围放到默认宽度
const PANEL_ZOOM_MAX = 2;

const isPanelSide = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= PANEL_SIDE_MIN && v <= PANEL_SIDE_MAX;
const isPanelMeters = (v: unknown): v is number => typeof v === 'number' && v >= PANEL_METERS_MIN && v <= PANEL_METERS_MAX;

// provides / requires / uses：服务名数组，重复的只留一个；没写时为 undefined
function parseServices(raw: unknown, key: string, errors: string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) && raw.every(isServiceName)) return [...new Set(raw)];
  errors.push(`${key} 要是服务名数组(小写字母、数字和 -)`);
  return undefined;
}

// usage：币种和各用量的单位名；没写时为 undefined
function parseUsage(raw: unknown, errors: string[]): UsageDecl | undefined {
  if (raw === undefined) return undefined;
  if (isObject(raw) && typeof raw['currency'] === 'string' && CURRENCY.test(raw['currency']) && isUnits(raw['units'])) {
    return { currency: raw['currency'], units: raw['units'] };
  }
  errors.push('usage 要是 { currency: 三个大写字母, units: { 用量名: 文案 } }');
  return undefined;
}

// panel：组件提供的面板。没写时为 undefined(panel 组件没写是错)；写了的值不合格一律记错误，不替它换成合格的值。
// panel 组件的入口写在 panel.page，hasPage = 清单另外写了顶层的 page
export function parsePanel(raw: unknown, kind: ComponentKind | undefined, errors: string[], hasPage = false): PanelDecl | undefined {
  if (kind === 'panel' && hasPage) errors.push('panel 组件的入口写在 panel.page，不写 page');
  if (raw === undefined) {
    if (kind === 'panel') errors.push('panel 组件要有 panel 字段');
    return undefined;
  }
  if (!isObject(raw)) {
    errors.push('panel 要是对象');
    return undefined;
  }
  const given = (key: string): boolean => raw[key] !== undefined;
  // 记一条错误，给出 undefined
  const bad = (message: string): undefined => void errors.push(message);
  // 开关：没写用 fallback，写了不是 true / false 时为 undefined
  const flag = (key: string, fallback: boolean): boolean | undefined => {
    const v = raw[key];
    return v === undefined ? fallback : typeof v === 'boolean' ? v : bad(`panel.${key} 要是 true / false`);
  };

  const { page, width, height } = raw;
  if (!isInnerPath(page)) bad('panel.page 要是组件包内的相对路径');
  const sized = isPanelSide(width) && isPanelSide(height);
  if (!sized) bad(`panel.width 和 panel.height 要是 ${PANEL_SIDE_MIN}–${PANEL_SIDE_MAX} 的整数`);
  const scale = given('scale') ? PANEL_SCALES.find(x => x === raw['scale']) ?? bad(`panel.scale 只能是 ${PANEL_SCALES.join('、')}`) : 1;
  const fits = sized && scale !== undefined && width * height * scale * scale <= PANEL_TEXELS_MAX;
  if (sized && scale !== undefined && !fits) bad(`panel 的纹理(宽 × 高 × scale²)不能超过 ${PANEL_TEXELS_MAX} 像素`);
  const fps = given('fps') ? raw['fps'] : PANEL_FPS;
  const fpsOk = typeof fps === 'number' && Number.isInteger(fps) && fps >= 1 && fps <= PANEL_FPS_MAX;
  if (!fpsOk) bad(`panel.fps 要是 1–${PANEL_FPS_MAX} 的整数`);
  const meters = given('meters') ? raw['meters'] : PANEL_METERS;
  const around = isPanelMeters(meters) ? meters : PANEL_METERS;
  const minMeters = given('minMeters') ? raw['minMeters'] : Math.min(PANEL_ZOOM_MIN, around);
  const maxMeters = given('maxMeters') ? raw['maxMeters'] : Math.max(PANEL_ZOOM_MAX, around);
  const ranged = isPanelMeters(meters) && isPanelMeters(minMeters) && isPanelMeters(maxMeters) && minMeters <= meters && meters <= maxMeters;
  if (!ranged) bad(`panel.minMeters ≤ panel.meters ≤ panel.maxMeters，都在 ${PANEL_METERS_MIN}–${PANEL_METERS_MAX} 米`);
  const anchor = given('anchor') ? PANEL_ANCHORS.find(x => x === raw['anchor']) ?? bad(`panel.anchor 只能是 ${PANEL_ANCHORS.join(' / ')}`) : 'world';
  const spawn = given('spawn') ? PANEL_SPAWNS.find(x => x === raw['spawn']) ?? bad(`panel.spawn 只能是 ${PANEL_SPAWNS.join(' / ')}`) : 'front';
  const glance = flag('glance', anchor === 'left' || anchor === 'right');
  const keep = flag('keep', false);
  const sound = flag('sound', false);
  const slots = given('slots') ? raw['slots'] : [];
  const slotted = Array.isArray(slots) && slots.every(isServiceName);
  if (!slotted) bad('panel.slots 要是插槽名数组(小写字母、数字和 -)');

  if (!isInnerPath(page) || !fits || !fpsOk || !ranged || !anchor || !spawn || !slotted) return undefined;
  if (glance === undefined || keep === undefined || sound === undefined) return undefined;
  return { page, width, height, scale, fps, meters, minMeters, maxMeters, anchor, spawn, glance, keep, sound, slots: [...new Set(slots)] };
}

// dashboard：仪表盘卡片，keys 要是 config 里的设置项；格式不对时为 null
function readDashboard(raw: unknown, settings: readonly SettingDef[]): DashboardCard | null {
  if (!isObject(raw)) return null;
  const { title, keys, toggle, link, grow } = raw;
  const area = raw['area'] ?? 'left';
  const order = raw['order'] ?? 0;
  const isSettingKey = (k: unknown): k is string => typeof k === 'string' && settings.some(d => d.key === k);
  if (!isText(title) || !Array.isArray(keys) || !keys.every(isSettingKey)) return null;
  if ((area !== 'left' && area !== 'right') || typeof order !== 'number' || !Number.isFinite(order)) return null;
  if ((toggle !== undefined && !isText(toggle)) || (link !== undefined && typeof link !== 'boolean') || (grow !== undefined && typeof grow !== 'boolean')) return null;
  const card: DashboardCard = { title, keys, area, order, link: link === true, grow: grow === true };
  if (isText(toggle)) card.toggle = toggle;
  return card;
}

function parseDashboard(raw: unknown, settings: readonly SettingDef[], errors: string[]): DashboardCard | undefined {
  if (raw === undefined) return undefined;
  const card = readDashboard(raw, settings);
  if (!card) errors.push('dashboard 要是 { title, keys: [config 里的键], area?: left / right, order?, toggle?, link?, grow? }');
  return card ?? undefined;
}

// 校验 component.json 的内容
export function parseManifest(raw: unknown): ManifestResult {
  if (!isObject(raw)) return { ok: false, errors: ['component.json 不是对象'] };
  const errors: string[] = [];
  // 记一条错误；placeholder 只用来占住类型，有错误时不会组装清单
  const bad = <T>(message: string, placeholder: T): T => {
    errors.push(message);
    return placeholder;
  };
  const has = (key: string): boolean => raw[key] !== undefined;

  const id = isComponentId(raw['id']) ? raw['id'] : bad('id 要写成「作者.名字」，只用小写字母、数字和 -', '');
  const kind = isComponentKind(raw['kind']) ? raw['kind'] : bad(`kind 要是 ${COMPONENT_KINDS.join(' / ')}`, undefined);
  const name = isText(raw['name']) ? raw['name'] : bad('name 缺少或格式不对', '');
  const version = typeof raw['version'] === 'string' && SEMVER.test(raw['version']) ? raw['version'] : bad('version 要是 x.y.z', '');
  const author = typeof raw['author'] === 'string' && raw['author'] ? raw['author'] : bad('author 缺少', '');
  const license = typeof raw['license'] === 'string' && raw['license'] ? raw['license'] : bad('license 缺少', '');
  const { description, repository, bugs, enabled } = raw;
  if (description !== undefined && !isText(description)) errors.push('description 格式不对');

  const provides = parseServices(raw['provides'], 'provides', errors);
  const requires = parseServices(raw['requires'], 'requires', errors);
  const uses = parseServices(raw['uses'], 'uses', errors);
  if (kind === 'service' && !provides?.length) errors.push('service 组件要声明 provides');
  if (kind !== 'service' && kind !== 'window' && provides !== undefined) errors.push('只有 service、window 组件能声明 provides');
  if (repository !== undefined && !isWebUrl(repository)) errors.push('repository 要是 http / https 地址');
  if (bugs !== undefined && !isWebUrl(bugs)) errors.push('bugs 要是 http / https 地址');
  if (enabled !== undefined && typeof enabled !== 'boolean') errors.push('enabled 要是 true / false');
  const usage = parseUsage(raw['usage'], errors);

  // 入口和文件
  if (has('window') && kind === 'window') errors.push('window 组件的主窗口入口写在 page');
  const proc = raw['process'];
  if (proc !== undefined && proc !== 'own') errors.push('process 只能是 own');
  if (proc !== undefined && !has('main')) errors.push('process 要和 main 入口一起用');
  const paths: Partial<Record<typeof PATH_KEYS[number], string>> = {};
  for (const key of PATH_KEYS) {
    const p = raw[key];
    if (isInnerPath(p)) paths[key] = p;
    else if (p !== undefined) errors.push(`${key} 要是组件包内的相对路径`);
  }

  // 各类别必须有的东西
  if (kind && NEEDS_PAGE.has(kind) && !has('page')) errors.push(`${kind} 组件要有 page 入口`);
  if (kind === 'layout' && !has('page') && !has('layout')) errors.push('layout 组件要有 page 入口或 layout 布局文件');
  if (kind === 'skin' && !has('skin')) errors.push('skin 组件要有 skin 样式文件');
  if (kind === 'lang' && !isObject(raw['ime'])) errors.push('lang 组件要有 ime 对象');
  if ((kind === 'output' || kind === 'input' || kind === 'translator') && !has('main')) errors.push(`${kind} 组件要有 main 入口`);
  const panel = parsePanel(raw['panel'], kind, errors, has('page'));

  const { settings, sections } = parseConfig(raw['config'], errors);
  const dashboard = parseDashboard(raw['dashboard'], settings, errors);
  // kind 不合格时上面已经记了错误，这里再判一次只为收窄类型
  if (errors.length || !kind) return { ok: false, errors };

  const manifest: Manifest = { id, kind, name, version, author, license, settings, sections, enabled: enabled !== false };
  if (isText(description)) manifest.description = description;
  if (isWebUrl(repository)) manifest.repository = repository;
  if (isWebUrl(bugs)) manifest.bugs = bugs;
  if (provides) manifest.provides = provides;
  if (requires?.length) manifest.requires = requires;
  if (uses?.length) manifest.uses = uses;
  if (paths.page !== undefined) manifest.page = paths.page;
  if (paths.window !== undefined) manifest.window = paths.window;
  if (paths.main !== undefined) manifest.main = paths.main;
  if (proc === 'own') manifest.process = 'own';
  if (paths.icon !== undefined) manifest.icon = paths.icon;
  if (panel) manifest.panel = panel;
  if (paths.layout !== undefined) manifest.layout = paths.layout;
  if (paths.skin !== undefined) manifest.skin = paths.skin;
  if (kind === 'lang') manifest.ime = raw['ime'];
  if (usage) manifest.usage = usage;
  if (dashboard) manifest.dashboard = dashboard;
  return { ok: true, manifest };
}

// 按界面语言取文案：没有这个语言时依次用简体中文、英文、第一个
export function textOf(text: Text, locale: Locale): string {
  if (typeof text === 'string') return text;
  return text[locale] ?? text['zh-Hans'] ?? text.en ?? Object.values(text)[0] ?? '';
}
