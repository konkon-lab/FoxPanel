// 版本号 x.y.z：解析、比较、范围检查(组件版本、npm 包版本、组件包要的宿主版本)。

type Version = readonly [number, number, number];

// 读出 x.y.z 三段(前面可以带 v，预发布后缀忽略)；读不出时为 null
export function parseVersion(v: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const ZERO: Version = [0, 0, 0];
const cmp = (a: Version, b: Version): number => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

// 比较版本号(忽略预发布后缀)，返回 -1 / 0 / 1；读不出的版本按 0.0.0
export function compareVersions(a: string, b: string): number {
  return Math.sign(cmp(parseVersion(a) ?? ZERO, parseVersion(b) ?? ZERO));
}

// 版本是否在范围里：支持 *、x.y.z、^、~、>=、>、<=、<，空格表示「且」，|| 表示「或」；看不懂的范围算不满足
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split('||').some(alt => alt.trim().split(/\s+/).every(term => {
    if (term === '' || term === '*' || term === 'x') return true;
    const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(term);
    const r = m ? parseVersion(m[2]!) : null;
    if (!m || !r) return false;
    const c = cmp(v, r);
    switch (m[1]) {
      case '^': return c >= 0 && (r[0] > 0 ? v[0] === r[0] : r[1] > 0 ? v[0] === 0 && v[1] === r[1] : v[0] === 0 && v[1] === 0 && v[2] === r[2]);
      case '~': return c >= 0 && v[0] === r[0] && v[1] === r[1];
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  }));
}
