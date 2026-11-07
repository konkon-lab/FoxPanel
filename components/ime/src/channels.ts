// 输入法组件主进程部分和主窗口部分之间的总线频道，和频道上数据的收窄(总线是公共的，别的组件也能往这些频道发)。
import type { Labels } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../../_shared/util.ts';

export const GET = 'yanuo.ime/get';               // 主窗口 → 主进程：要一份语言信息
export const LANGS = 'yanuo.ime/langs';           // 主进程 → 主窗口：语言信息(LangsInfo)
export const MODE = 'yanuo.ime/mode';             // 主窗口 → 主进程：{ id: 语言组件 id, mode: 模式 id }
export const SOGOU = 'yanuo.ime/sogou';           // 主窗口 → 主进程：导入搜狗词库
export const SOGOU_DONE = 'yanuo.ime/sogou-done'; // 主进程 → 主窗口：导入结果(SogouImport)

export interface LangsInfo {
  langs: { id: string; pinyin: boolean; modes: { id: string; label: Labels }[] }[];   // 全部能用的语言
  modes: Record<string, string>;   // 各语言当前的模式
  sogouWords: number;              // 已导入的搜狗词条数，0 = 未导入
}

// 导入搜狗词库的结果；error 是给用户看的原因
export type SogouImport = { ok: true; count: number } | { ok: false; error: string };

const isStrings = (v: unknown): v is Record<string, string> => isObject(v) && Object.values(v).every(x => typeof x === 'string');
const isLabels = (v: unknown): v is Labels => typeof v === 'string' || isStrings(v);
const isMode = (v: unknown): v is LangsInfo['langs'][number]['modes'][number] => isObject(v) && typeof v['id'] === 'string' && isLabels(v['label']);
const isLang = (v: unknown): v is LangsInfo['langs'][number] =>
  isObject(v) && typeof v['id'] === 'string' && typeof v['pinyin'] === 'boolean' && Array.isArray(v['modes']) && v['modes'].every(isMode);

// LANGS 频道的数据；格式不对返回 null
export function parseLangsInfo(v: unknown): LangsInfo | null {
  if (!isObject(v)) return null;
  const { langs, modes, sogouWords } = v;
  if (!Array.isArray(langs) || !langs.every(isLang)) return null;
  if (!isStrings(modes) || typeof sogouWords !== 'number') return null;
  return { langs, modes, sogouWords };
}

// SOGOU_DONE 频道的数据；格式不对返回 null
export function parseSogouResult(v: unknown): SogouImport | null {
  if (!isObject(v)) return null;
  if (v['ok'] === true && typeof v['count'] === 'number') return { ok: true, count: v['count'] };
  if (v['ok'] === false && typeof v['error'] === 'string') return { ok: false, error: v['error'] };
  return null;
}
