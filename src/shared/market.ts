// npm 上的组件包(docs/market.md)：包名、关键词、package.json 的 foxpanel 字段(市场用的摘要)。

import { isComponentId, isComponentKind, type ComponentKind, type Manifest } from './manifest.ts';
import { isText, type Text } from './schema.ts';
import { isObject } from './util.ts';

export const KEYWORD = 'foxpanel-component';
export const SDK_PACKAGE = '@konkon-lab/foxpanel-sdk';
// 包名：foxpanel-component-<名字> 或 @作者/foxpanel-component-<名字>
export const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?foxpanel-component-[a-z0-9][a-z0-9._~-]*$/;

// package.json 的 foxpanel 字段
export interface MarketSummary {
  id: string;
  kind: ComponentKind;
  name: Text;
  description?: Text;
  code: boolean;            // 带代码
  provides?: string[];
  requires?: string[];
}

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : undefined);

// 读 foxpanel 字段；不合格时为 null
export function parseSummary(o: unknown): MarketSummary | null {
  if (!isObject(o)) return null;
  const kind = o['kind'];
  if (!isComponentId(o['id']) || !isComponentKind(kind) || !isText(o['name'])) return null;
  const out: MarketSummary = { id: o['id'], kind, name: o['name'], code: o['code'] === true };
  if (isText(o['description'])) out.description = o['description'];
  const provides = strings(o['provides']);
  const requires = strings(o['requires']);
  if (provides) out.provides = provides;
  if (requires) out.requires = requires;
  return out;
}

// 由清单生成 foxpanel 字段(打包脚本用)
export function summaryOf(m: Manifest, code: boolean): MarketSummary {
  const out: MarketSummary = { id: m.id, kind: m.kind, name: m.name, code };
  if (m.description !== undefined) out.description = m.description;
  if (m.provides) out.provides = m.provides;
  if (m.requires) out.requires = m.requires;
  return out;
}
