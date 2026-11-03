// 组件市场的数据：列表用 npm 官方的搜索接口(镜像大多不支持搜索)，包信息和版本从设置里的仓库读。结果缓存一会儿。

import { KEYWORD, PACKAGE_NAME, parseSummary, SDK_PACKAGE } from '../../shared/market.ts';
import type { MarketItem, MarketPackage } from '../../shared/types.ts';
import { isObject } from '../../shared/util.ts';
import { compareVersions, satisfies } from '../../shared/version.ts';

// npm 官方仓库；开发时可以用环境变量 FOXPANEL_NPM 指到本机的测试仓库
const NPM = process.env['FOXPANEL_NPM'] ?? 'https://registry.npmjs.org';
const SEARCH = `${NPM}/-/v1/search`;
const SEARCH_SIZE = 250;         // 一次最多列这么多个包
const CACHE_MS = 10 * 60_000;    // 市场列表缓存这么久(毫秒)
const TIMEOUT_MS = 15_000;       // 一次请求最长等这么久(毫秒)
const PARALLEL = 8;              // 同时读几个包的信息
const AGE_MS = 86_400_000;       // 发布满这么久的版本才装(毫秒；和 yarn 的 npmMinimalAgeGate 默认值一样，1 天)

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// 取一个地址的 JSON；状态码不是 2xx 或超时时抛出异常
async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}：${url}`);
  return r.json();
}

// 仓库里包的地址：作用域包的 / 要转义
const packageUrl = (registry: string, name: string): string => `${registry.replace(/\/+$/, '')}/${name.replace('/', '%2f')}`;

export class Market {
  private readonly registry: () => string;
  private readonly sdk: string;    // 宿主的 SDK 版本(程序版本)
  private list: { at: number; items: MarketItem[] } | null = null;

  constructor(registry: () => string, sdk: string) {
    this.registry = registry;
    this.sdk = sdk;
  }

  // 市场里的全部组件(按下载量排)；refresh = 不用缓存
  async search(refresh = false): Promise<MarketItem[]> {
    if (!refresh && this.list && Date.now() - this.list.at < CACHE_MS) return this.list.items;
    const raw = await getJson(`${SEARCH}?text=${encodeURIComponent(`keywords:${KEYWORD}`)}&size=${SEARCH_SIZE}`);
    const objects = isObject(raw) && Array.isArray(raw['objects']) ? raw['objects'] : [];
    const found = objects.flatMap(o => {
      const p = isObject(o) && isObject(o['package']) ? o['package'] : null;
      if (!p || !PACKAGE_NAME.test(str(p['name']))) return [];
      const downloads = isObject(o) && isObject(o['downloads']) && typeof o['downloads']['monthly'] === 'number' ? o['downloads']['monthly'] : 0;
      const publisher = isObject(p['publisher']) ? str(p['publisher']['username']) : '';
      const links = isObject(p['links']) ? p['links'] : {};
      return [{ name: str(p['name']), version: str(p['version']), description: str(p['description']), date: str(p['date']), publisher, downloads, repository: str(links['repository']) }];
    });
    // 每个包最新版的 foxpanel 字段(搜索结果里没有)
    const items: MarketItem[] = [];
    for (let i = 0; i < found.length; i += PARALLEL) {
      const batch = await Promise.all(found.slice(i, i + PARALLEL).map(async f => {
        try {
          const latest = await getJson(`${packageUrl(NPM, f.name)}/${f.version}`);
          const component = isObject(latest) ? parseSummary(latest['foxpanel']) : null;
          return component ? { ...f, component } : null;
        } catch {
          return null;
        }
      }));
      for (const b of batch) if (b) items.push(b);
    }
    items.sort((a, b) => b.downloads - a.downloads);
    this.list = { at: Date.now(), items };
    return items;
  }

  // 一个包的信息：能装的版本(发布满一天，新的在前)、指定版本(默认能装的最新版)的摘要、许可证、README、能不能装
  async info(name: string, version?: string): Promise<MarketPackage> {
    if (!PACKAGE_NAME.test(name)) throw new Error(`不是组件包：${name}`);
    const doc = await getJson(packageUrl(this.registry(), name));
    if (!isObject(doc) || !isObject(doc['versions'])) throw new Error(`仓库里没有 ${name}`);
    const all = doc['versions'];
    const times = isObject(doc['time']) ? doc['time'] : {};
    // 发布不满一天的版本 yarn 不装(npmMinimalAgeGate 默认值)；没有发布时间的也算
    const fresh = (v: string): boolean => !(Date.now() - Date.parse(str(times[v])) >= AGE_MS);
    const versions = Object.keys(all).filter(v => isObject(all[v]) && !all[v]['deprecated'] && !fresh(v)).sort((a, b) => compareVersions(b, a));
    const tags = isObject(doc['dist-tags']) ? doc['dist-tags'] : {};
    const latest = str(tags['latest']);
    const pick = version ?? (latest && !fresh(latest) ? latest : versions[0]);
    const v = pick ? all[pick] : undefined;
    if (!pick || !isObject(v)) throw new Error(version ? `${name} 没有 ${version} 这个版本` : `${name} 没有可用的版本`);
    const component = parseSummary(v['foxpanel']);
    const peers = isObject(v['peerDependencies']) ? v['peerDependencies'] : {};
    const sdk = str(peers[SDK_PACKAGE]);
    const out: MarketPackage = {
      name, version: pick, versions, component, license: str(v['license']), readme: str(doc['readme']),
      compatible: component !== null && (!sdk || satisfies(this.sdk, sdk)),
    };
    if (sdk) out.sdk = sdk;
    if (fresh(pick)) {
      const at = Date.parse(str(times[pick]));
      out.readyAt = Number.isFinite(at) ? new Date(at + AGE_MS).toISOString() : '';
    }
    return out;
  }
}
